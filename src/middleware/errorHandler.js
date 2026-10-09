const { AppError } = require('../utils/errors');

function notFound(req, res) {
  res.status(404).json({
    success: false,
    errorCode: 'ROUTE_NOT_FOUND',
    message: `Route ${req.method} ${req.originalUrl} does not exist.`,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      errorCode: err.errorCode,
      message: err.message,
      ...(err.details && { details: err.details }),
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, errorCode: 'INVALID_JSON', message: 'Request body contains malformed JSON.' });
  }
  console.error(err);
  return res.status(500).json({
    success: false,
    errorCode: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred. Please try again later.',
  });
}

module.exports = { notFound, errorHandler };
