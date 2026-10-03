// En-têtes de sécurité HTTP (OWASP ASVS V3/V14) — sans dépendance

const PERMISSIONS_POLICY = [
  'camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()',
  'serial=()', 'bluetooth=()', 'magnetometer=()', 'gyroscope=()', 'accelerometer=()',
  'interest-cohort=()', 'browsing-topics=()',
].join(', ');

// réponses API : rien ne doit s'exécuter ni être encadré
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// interface servie localement (LAN) par Express : même origine pour l'API
export const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function isHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', API_CSP);
  res.removeHeader('X-Powered-By');
  // HSTS uniquement sur HTTPS (nginx / tunnel) : 2 ans
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  // données personnelles : jamais en cache partagé
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

// à appliquer sur les fichiers de l'interface (index.html, assets)
export function spaCsp(_req, res, next) {
  res.setHeader('Content-Security-Policy', SPA_CSP);
  next();
}

// CORS : une seule liste blanche pour Express, les préflights et Socket.IO
export function buildCorsOptions(allowedOrigins) {
  return {
    origin: (origin, cb) => {
      // requêtes sans Origin (curl, appareils, même origine en GET) : pas d'en-têtes CORS nécessaires
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  };
}
