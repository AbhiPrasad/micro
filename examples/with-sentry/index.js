const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");
const { send } = require("micro");

Sentry.init({
  // Fill in your DSN here. You can find it in your Sentry project settings.
  dsn: process.env.SENTRY_DSN,
  // Enable performance monitoring by sampling at a 100%. You should adjust this value in production.
  tracesSampleRate: 1.0,
  // Enable debug logs. Turn this off in production.
  debug: true,
  integrations: [
    // Generate spans for all outgoing HTTP requests.
    new Sentry.Integrations.Http({ tracing: true }),
  ],
});

function withSentry(handler) {
  return async function (req, res) {
    // Use the sentry-trace header to decide if this transaction should be connected to a
    // downstream trace.
    const sentryTraceHeader = req.headers["sentry-trace"];
    const traceparentData =
      typeof sentryTraceHeader === "string"
        ? Tracing.extractTraceparentData(sentryTraceHeader)
        : undefined;

    // Create a transaction
    const transaction = Sentry.startTransaction({
      op: "http.server",
      // name will be something like "GET /" or "POST /api/users"
      name: `${req.method} ${req.url}`,
      status: "ok",
      ...traceparentData,
    });
    // Set the transaction on the scope so it can be associated to errors
    Sentry.configureScope((scope) => scope.setSpan(transaction));

    // On finish, finish the transaction and flush events
    res.once("finish", async () => {
      transaction.setHttpStatus(req.statusCode);
      // Finish the transaction
      transaction.finish();
      // Flush events before returning, otherwise the transaction will not show up
      await Sentry.flush(1000);
    });
    try {
      return await handler(req, res);
    } catch (err) {
      // If there is an error, set the status to error
      transaction.setHttpStatus(err.statusCode || 500);
      Sentry.captureException(err);
      // Log out error to console
      console.error(err);
      send(res, 500, err.message);
    }
  };
}

module.exports = withSentry(async (req, res) => {
  const err = new Error("Something has gone terribly wrong!");
  err.statusCode = 500;
  throw err;
});
