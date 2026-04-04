Exemple ESP32-CAM: annonce HTTP vers le serveur surveillance

But:
- connecter l'ESP32-CAM au Wi-Fi
- annoncer automatiquement son IP et son URL de flux au backend
- publier un service mDNS pour eviter le scan IP massif
- faire apparaitre la camera dans la section ESP32 vues recemment

Fichiers:
- esp32-cam-http-announce.ino

Prerequis:
- carte ESP32-CAM AI Thinker ou broches adaptees
- bibliotheques ArduinoJson et esp32 camera disponibles
- un firmware ou un sketch qui expose bien le flux video sur `http://IP:81/stream`

Constantes a adapter dans le sketch:
- `WIFI_SSID`
- `WIFI_PASSWORD`
- `SERVER_BASE_URL`
- `DEVICE_ID`
- `DEVICE_NAME`
- `DEVICE_LOCATION`
- `MDNS_HOSTNAME`
- `STREAM_PORT`
- `STREAM_PATH`

Endpoint appele:
- `POST /api/cameras/announce`

Payload envoye:
```json
{
  "deviceId": "esp32cam-salon",
  "name": "ESP32 Salon",
  "host": "192.168.1.42",
  "streamUrl": "http://192.168.1.42:81/stream",
  "location": "Salon",
  "model": "AI Thinker ESP32-CAM",
  "source": "announce"
}
```

Important:
- le serveur doit etre joignable depuis l'ESP32 sur le reseau local
- l'URL du flux doit correspondre a votre firmware
- le sketch publie maintenant un service mDNS `_http._tcp` pour que le serveur puisse detecter l'ESP32-CAM sans scan IP complet
- le backend garde la camera visible pendant la duree definie par `CAMERA_DISCOVERY_TTL_MINUTES`