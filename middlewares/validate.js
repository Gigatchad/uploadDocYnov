// middlewares/validate.js
const { validationResult } = require('express-validator');

function handleValidation(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  return res.status(400).json({ error: 'VALIDATION_ERROR', details: result.array() });
}

module.exports = { handleValidation };
