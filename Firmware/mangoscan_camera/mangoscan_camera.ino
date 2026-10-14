/*
 * MangoScan camera (AI-Thinker ESP32-CAM)
 *
 * Takes a photo when the laptop asks for one and sends it back over the USB
 * cable. Wire format, flashing and troubleshooting: Firmware/README.md
 *
 * Board: "AI Thinker ESP32-CAM" (needs the PSRAM it ships with).
 * No extra libraries: esp_camera is part of the ESP32 Arduino core.
 */
#include "esp_camera.h"
#include "esp_log.h"

// ----------------------------------------------------------------------------
// CONFIGURE
// ----------------------------------------------------------------------------
static const char *DEVICE_ID = "cam-1";
static const unsigned long BAUD = 921600;  // must match SERIAL_BAUD on the laptop

// Angles this camera can deliver. One physical camera that sees the mango from
// several positions (rotation or mirrors) lists them all. With one camera per
// angle, flash each board with just its own number, for example {2}.
static const int ANGLES[] = {1, 2, 3, 4, 5};

static const framesize_t FRAME_SIZE = FRAMESIZE_VGA;  // 640x480, about 20-40 KB per photo
static const int JPEG_QUALITY = 12;                   // 10 best .. 63 smallest
static const bool USE_FLASH_LED = false;              // the on-board white LED on GPIO 4
static const int FLASH_LED_PIN = 4;
static const bool FLUSH_STALE_FRAME = true;           // drop the buffered frame so each photo is fresh
// ----------------------------------------------------------------------------

// AI-Thinker pin map
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

static bool cameraReady = false;
static char line[256];
static size_t lineLen = 0;

// ---- tiny JSON helpers ------------------------------------------------------

static const char *findValue(const char *json, const char *key) {
  char pat[24];
  snprintf(pat, sizeof(pat), "\"%s\"", key);
  const char *p = strstr(json, pat);
  if (!p) return nullptr;
  p += strlen(pat);
  while (*p == ' ' || *p == ':') p++;
  return p;
}

static long jsonInt(const char *json, const char *key, long fallback) {
  const char *v = findValue(json, key);
  if (!v) return fallback;
  char *end;
  long n = strtol(v, &end, 10);
  return end == v ? fallback : n;
}

static bool jsonStr(const char *json, const char *key, char *out, size_t cap) {
  const char *v = findValue(json, key);
  if (!v || *v != '"') return false;
  v++;
  size_t i = 0;
  while (*v && *v != '"' && i + 1 < cap) out[i++] = *v++;
  out[i] = 0;
  return *v == '"';
}

// ---- protocol -------------------------------------------------------------------

static void sendHello() {
  Serial.printf("{\"t\":\"hello\",\"id\":\"%s\",\"caps\":[\"camera\"],\"angles\":[", DEVICE_ID);
  const int n = sizeof(ANGLES) / sizeof(ANGLES[0]);
  for (int i = 0; i < n; i++) Serial.printf("%s%d", i ? "," : "", ANGLES[i]);
  Serial.print("],\"fw\":\"1.0\"}\n");
}

static void sendError(long scanId, long angle, const char *msg) {
  Serial.printf("{\"t\":\"err\",\"scan_id\":%ld,\"angle\":%ld,\"msg\":\"%s\"}\n", scanId, angle, msg);
}

static void handleCapture(const char *json) {
  long scanId = jsonInt(json, "scan_id", -1);
  long angle = jsonInt(json, "angle", -1);
  if (scanId < 0 || angle < 1) return;
  if (!cameraReady) {
    sendError(scanId, angle, "camera not initialised");
    return;
  }

  if (USE_FLASH_LED) digitalWrite(FLASH_LED_PIN, HIGH);
  if (FLUSH_STALE_FRAME) {
    camera_fb_t *stale = esp_camera_fb_get();
    if (stale) esp_camera_fb_return(stale);
  }
  camera_fb_t *fb = esp_camera_fb_get();
  if (USE_FLASH_LED) digitalWrite(FLASH_LED_PIN, LOW);

  if (!fb) {
    sendError(scanId, angle, "capture failed");
    return;
  }
  // Header line, then exactly len raw JPEG bytes.
  Serial.printf("{\"t\":\"img\",\"scan_id\":%ld,\"angle\":%ld,\"len\":%u}\n", scanId, angle, (unsigned)fb->len);
  const size_t CHUNK = 1024;
  for (size_t sent = 0; sent < fb->len; sent += CHUNK) {
    size_t n = fb->len - sent < CHUNK ? fb->len - sent : CHUNK;
    Serial.write(fb->buf + sent, n);
  }
  Serial.flush();
  esp_camera_fb_return(fb);
}

static void handleLine(const char *json) {
  char type[16];
  if (!jsonStr(json, "t", type, sizeof(type))) return;
  if (strcmp(type, "hello?") == 0) sendHello();
  else if (strcmp(type, "ping") == 0) Serial.print("{\"t\":\"pong\"}\n");
  else if (strcmp(type, "capture") == 0) handleCapture(json);
}

static void readSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      line[lineLen] = 0;
      if (lineLen > 0) handleLine(line);
      lineLen = 0;
    } else if (c != '\r') {
      if (lineLen + 1 < sizeof(line)) line[lineLen++] = c;
      else lineLen = 0;
    }
  }
}

static bool initCamera() {
  camera_config_t config = {};
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
  config.frame_size = FRAME_SIZE;
  config.jpeg_quality = JPEG_QUALITY;
  config.grab_mode = CAMERA_GRAB_LATEST;
  if (psramFound()) {
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }
  return esp_camera_init(&config) == ESP_OK;
}

void setup() {
  Serial.begin(BAUD);
  // Driver log lines would land in the middle of a photo on the same wire.
  Serial.setDebugOutput(false);
  esp_log_level_set("*", ESP_LOG_NONE);
  if (USE_FLASH_LED) {
    pinMode(FLASH_LED_PIN, OUTPUT);
    digitalWrite(FLASH_LED_PIN, LOW);
  }
  cameraReady = initCamera();
  delay(300);
  sendHello();
  if (!cameraReady) Serial.print("{\"t\":\"log\",\"msg\":\"camera init failed\"}\n");
}

void loop() {
  readSerial();
}
