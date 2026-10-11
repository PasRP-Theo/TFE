// Fausse caméra ONVIF pour les tests : service SOAP (HTTP) qui vérifie la signature
// WS-Security comme une vraie caméra, et répondeur WS-Discovery (UDP).
import http from 'http';
import dgram from 'dgram';
import { createHash } from 'crypto';

const xmlText = (xml, name) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)<`).exec(xml)?.[1] ?? null;

function envelope(body) {
  return `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

const NOT_AUTHORIZED = envelope('<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value><SOAP-ENV:Subcode><SOAP-ENV:Value>ter:NotAuthorized</SOAP-ENV:Value></SOAP-ENV:Subcode></SOAP-ENV:Code><SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">Sender not Authorized</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>');

function profileXml({ token, name, encoding, width, height }) {
  return `<trt:Profiles token="${token}" fixed="true"><tt:Name>${name}</tt:Name><tt:VideoSourceConfiguration token="VSC"><tt:Name>VideoSource</tt:Name></tt:VideoSourceConfiguration><tt:VideoEncoderConfiguration token="VEC_${token}"><tt:Name>${name}Encoder</tt:Name><tt:Encoding>${encoding}</tt:Encoding><tt:Resolution><tt:Width>${width}</tt:Width><tt:Height>${height}</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles>`;
}

/**
 * @param {object} options
 * @param {string} [options.username] @param {string} [options.password]
 * @param {object[]} [options.profiles]
 * @param {number} [options.clockSkewMs] heure de la caméra décalée (refuse une signature hors de ±5 s)
 * @param {string} [options.advertisedHost] hôte que la caméra annonce dans ses adresses (peut être faux)
 */
export async function startFakeOnvifCamera({
  username = 'admin',
  password = 'secret',
  manufacturer = 'Reolink',
  model = 'RLC-510A',
  profiles = [
    { token: '000', name: 'mainStream', encoding: 'H264', width: 2560, height: 1920 },
    { token: '001', name: 'subStream', encoding: 'H264', width: 640, height: 480 },
  ],
  clockSkewMs = 0,
  advertisedHost = '127.0.0.1',
} = {}) {
  const requests = [];

  function authorized(body) {
    const user = xmlText(body, 'Username');
    const digest = xmlText(body, 'Password');
    const nonce = xmlText(body, 'Nonce');
    const created = xmlText(body, 'Created');
    if (!user || !digest || !nonce || !created || user !== username) return false;
    // une vraie caméra refuse une signature datée hors de sa propre horloge
    if (Math.abs(Date.parse(created) - (Date.now() + clockSkewMs)) > 5000) return false;
    const expected = createHash('sha1')
      .update(Buffer.concat([Buffer.from(nonce, 'base64'), Buffer.from(created), Buffer.from(password)]))
      .digest('base64');
    return expected === digest;
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const action = /<s:Body><(\w+)/.exec(body)?.[1];
      requests.push({ path: req.url, action, body });
      const reply = (status, xml) => {
        res.writeHead(status, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
        res.end(xml);
      };
      if (req.url !== '/onvif/device_service' && req.url !== '/onvif/media_service') return reply(404, 'Not Found');
      const port = server.address().port;
      const now = new Date(Date.now() + clockSkewMs);

      if (action === 'GetSystemDateAndTime') {
        return reply(200, envelope(`<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>${now.getUTCHours()}</tt:Hour><tt:Minute>${now.getUTCMinutes()}</tt:Minute><tt:Second>${now.getUTCSeconds()}</tt:Second></tt:Time><tt:Date><tt:Year>${now.getUTCFullYear()}</tt:Year><tt:Month>${now.getUTCMonth() + 1}</tt:Month><tt:Day>${now.getUTCDate()}</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>`));
      }
      if (!authorized(body)) return reply(400, NOT_AUTHORIZED);

      switch (action) {
        case 'GetDeviceInformation':
          return reply(200, envelope(`<tds:GetDeviceInformationResponse><tds:Manufacturer>${manufacturer}</tds:Manufacturer><tds:Model>${model}</tds:Model><tds:FirmwareVersion>v3.0.0</tds:FirmwareVersion><tds:SerialNumber>00000000</tds:SerialNumber><tds:HardwareId>IPC</tds:HardwareId></tds:GetDeviceInformationResponse>`));
        case 'GetCapabilities':
          return reply(200, envelope(`<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>http://${advertisedHost}:${port}/onvif/media_service</tt:XAddr><tt:StreamingCapabilities><tt:RTP_TCP>true</tt:RTP_TCP></tt:StreamingCapabilities></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>`));
        case 'GetProfiles':
          return reply(200, envelope(`<trt:GetProfilesResponse>${profiles.map(profileXml).join('')}</trt:GetProfilesResponse>`));
        case 'GetStreamUri': {
          const token = xmlText(body, 'ProfileToken');
          const path = token === '001' ? 'h264Preview_01_sub' : 'h264Preview_01_main';
          return reply(200, envelope(`<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://${advertisedHost}:554/${path}?a=1&amp;b=2</tt:Uri><tt:InvalidAfterConnect>false</tt:InvalidAfterConnect></trt:MediaUri></trt:GetStreamUriResponse>`));
        }
        default:
          return reply(400, envelope('<SOAP-ENV:Fault><SOAP-ENV:Reason><SOAP-ENV:Text>Action not supported</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>'));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    port,
    xaddr: `http://${advertisedHost}:${port}/onvif/device_service`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

/** répondeur WS-Discovery : renvoie un ProbeMatch à chaque sonde reçue */
export async function startFakeDiscoveryResponder({ xaddrs, scopes = [], respond = true } = {}) {
  const socket = dgram.createSocket('udp4');
  const probes = [];
  socket.on('message', (message, rinfo) => {
    probes.push(message.toString());
    if (!respond) return;
    const reply = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><SOAP-ENV:Body><d:ProbeMatches><d:ProbeMatch><wsa:EndpointReference><wsa:Address>urn:uuid:2419d68a-2dd2-21b2-a205-ec71dbfbbd46</wsa:Address></wsa:EndpointReference><d:Types>dn:NetworkVideoTransmitter</d:Types><d:Scopes>${scopes.join(' ')}</d:Scopes><d:XAddrs>${xaddrs}</d:XAddrs><d:MetadataVersion>1</d:MetadataVersion></d:ProbeMatch></d:ProbeMatches></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    socket.send(reply, rinfo.port, rinfo.address);
  });
  await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  return {
    target: { address: '127.0.0.1', port: socket.address().port },
    probes,
    close: () => new Promise(resolve => socket.close(resolve)),
  };
}
