#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"

// Adaptez ces constantes a votre environnement.
static const char* WIFI_SSID = "VOTRE_WIFI";
static const char* WIFI_PASSWORD = "VOTRE_MOT_DE_PASSE";
static const char* SERVER_BASE_URL = "http://192.168.1.10:4000";
static const char* DEVICE_ID = "esp32cam-salon";
static const char* DEVICE_NAME = "ESP32 Salon";
static const char* DEVICE_LOCATION = "Salon";
static const char* DEVICE_MODEL = "AI Thinker ESP32-CAM";

// URL du flux servi par l'ESP32-CAM.
// La plupart des firmwares CameraWebServer exposent le MJPEG sur :81/stream.
static const uint16_t STREAM_PORT = 81;
static const char* STREAM_PATH = "/stream";

// Pins AI Thinker ESP32-CAM.
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA;
  config.jpeg_quality = 12;
  config.fb_count = 2;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t result = esp_camera_init(&config);
  if (result != ESP_OK) {
    Serial.printf("[CAM] Echec init camera: 0x%x\n", result);
    return false;
  }

  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor != nullptr) {
    sensor->set_vflip(sensor, 1);
    sensor->set_brightness(sensor, 1);
    sensor->set_saturation(sensor, -2);
  }

  return true;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("[WIFI] Connexion a %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  Serial.printf("[WIFI] Connecte, IP: %s\n", WiFi.localIP().toString().c_str());
}

String buildStreamUrl() {
  return String("http://") + WiFi.localIP().toString() + ":" + String(STREAM_PORT) + STREAM_PATH;
}

bool announceToServer() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String endpoint = String(SERVER_BASE_URL) + "/api/cameras/announce";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  JsonDocument payload;
  payload["deviceId"] = DEVICE_ID;
  payload["name"] = DEVICE_NAME;
  payload["host"] = WiFi.localIP().toString();
  payload["streamUrl"] = buildStreamUrl();
  payload["location"] = DEVICE_LOCATION;
  payload["model"] = DEVICE_MODEL;
  payload["source"] = "announce";

  String body;
  serializeJson(payload, body);

  int statusCode = http.POST(body);
  String response = http.getString();
  http.end();

  Serial.printf("[ANNOUNCE] HTTP %d\n", statusCode);
  if (response.length() > 0) {
    Serial.println(response);
  }

  return statusCode >= 200 && statusCode < 300;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  if (!initCamera()) {
    Serial.println("[BOOT] Camera non initialisee");
    return;
  }

  connectWifi();

  // Votre firmware doit aussi exposer le flux MJPEG sur STREAM_PORT/STREAM_PATH.
  // Si vous utilisez l'exemple CameraWebServer d'Espressif, adaptez seulement
  // l'URL du serveur et les constantes ci-dessus.
  bool ok = announceToServer();
  Serial.printf("[BOOT] Annonce envoyee: %s\n", ok ? "oui" : "non");
}

void loop() {
  static unsigned long lastHeartbeat = 0;
  const unsigned long heartbeatIntervalMs = 60000;

  if (millis() - lastHeartbeat >= heartbeatIntervalMs) {
    lastHeartbeat = millis();
    announceToServer();
  }
}