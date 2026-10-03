// environnement minimal pour les processus enfants (python) : jamais les secrets du serveur
const PASSTHROUGH = [
  'PATH', 'Path', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
  'LANG', 'LC_ALL', 'VIRTUAL_ENV', 'PYTHONPATH', 'YOLO_CONFIG_DIR', 'ULTRALYTICS_CONFIG_DIR',
];

export function buildChildEnv(extra = {}) {
  const env = {};
  for (const key of PASSTHROUGH) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, CUDA_VISIBLE_DEVICES: '', PYTHONUNBUFFERED: '1', ...extra };
}
