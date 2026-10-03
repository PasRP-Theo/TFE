export function isNumericId(value) {
  return /^\d+$/.test(String(value ?? ''));
}

// router.param : identifiant numérique uniquement (empêche « .. » dans les chemins de fichiers)
export function numericIdParam(_req, res, next, id) {
  if (!isNumericId(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  next();
}
