// middlewares/error.js

// 404 pour tout ce qui n'est pas géré
function notFound(req, res, next) {
  res.status(404).json({ error: 'Not found' });
}

// handler global pour éviter d'afficher des stacks moches au client
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const body = { error: code };

  // en dev, aide-toi avec le message
  if (process.env.NODE_ENV !== 'production') {
    body.message = err.message || String(err);
  }

  console.error('[ERROR]', { status, code, message: err.message, stack: err.stack });
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
