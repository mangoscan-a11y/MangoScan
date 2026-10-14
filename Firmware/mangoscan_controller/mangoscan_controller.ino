/*
 * MangoScan controller (ESP32 dev board)
 *
 * Moves the two sorting servos on command, reports when a bin is full, and
 * optionally tells the laptop that a mango has arrived at the camera station.
 *
 * Talks to the laptop over the USB cable as one JSON object per line.
 * See Firmware/README.md for the protocol, wiring and calibration.
 *
 * Library needed: "ESP32Servo" (Arduino Library Manager).
 * Board: "ESP32 Dev Module".
 */
#include <ESP32Servo.h>

// ----------------------------------------------------------------------------
// CONFIGURE FOR YOUR WIRING
// ----------------------------------------------------------------------------
static const char *DEVICE_ID = "ctrl-1";
static const unsigned long BAUD = 921600;  // must match SERIAL_BAUD on the laptop

static const int SERVO1_PIN = 18;  // selects the group: green, yellow, diseased, bruised
static const int SERVO2_PIN = 19;  // selects the slot: small, medium, large, park

// Bin-full sensors for bins 1..8. Wired between the pin and GND (internal pull-up).
static const int BIN_PINS[8] = {32, 33, 25, 26, 27, 14, 13, 4};
static const int BIN_FULL_LEVEL = LOW;  // pin level that means "this bin is full"

// Mango-arrived sensor (IR break beam etc.). Set to -1 if there is none.
static const int MANGO_PIN = 15;
static const int MANGO_ACTIVE_LEVEL = LOW;

// Servo angles in degrees. THESE ARE PLACEHOLDERS: calibrate on the real machine.
struct Pose {
  const char *name;
  int angle;
};
static const Pose SERVO1_POSES[] = {
    {"group_green", 20}, {"group_yellow", 65}, {"group_diseased", 110}, {"group_bruised", 155}};
static const Pose SERVO2_POSES[] = {
    {"slot_small", 30}, {"slot_medium", 90}, {"slot_large", 150}, {"slot_park", 90}};

static const unsigned long SERVO_SETTLE_MS = 400;  // time allowed for both servos to arrive
static const unsigned long DEBOUNCE_MS = 150;
// ----------------------------------------------------------------------------

Servo servo1;
Servo servo2;

static bool binState[8];
static bool binRaw[8];
static unsigned long binChangedAt[8];
static bool mangoWasActive = false;
static unsigned long mangoChangedAt = 0;

static char line[256];
static size_t lineLen = 0;

// ---- tiny JSON helpers (the protocol only uses flat objects) ---------------

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

// ---- protocol output --------------------------------------------------------

static void sendHello() {
  Serial.printf("{\"t\":\"hello\",\"id\":\"%s\",\"caps\":[\"servo\",\"bins\"%s],\"fw\":\"1.0\"}\n", DEVICE_ID,
                MANGO_PIN >= 0 ? ",\"mango\"" : "");
}

static void sendBin(int index) {
  Serial.printf("{\"t\":\"bin\",\"bin\":%d,\"full\":%s}\n", index + 1, binState[index] ? "true" : "false");
}

// ---- servo handling ------------------------------------------------------------

static int poseAngle(const Pose *poses, size_t count, const char *name) {
  for (size_t i = 0; i < count; i++) {
    if (strcmp(poses[i].name, name) == 0) return poses[i].angle;
  }
  return -1;
}

static void handleSort(const char *json) {
  long scanId = jsonInt(json, "scan_id", -1);
  char s1[32], s2[32];
  int a1 = -1, a2 = -1;
  if (jsonStr(json, "s1", s1, sizeof(s1))) a1 = poseAngle(SERVO1_POSES, sizeof(SERVO1_POSES) / sizeof(Pose), s1);
  if (jsonStr(json, "s2", s2, sizeof(s2))) a2 = poseAngle(SERVO2_POSES, sizeof(SERVO2_POSES) / sizeof(Pose), s2);

  if (scanId < 0 || a1 < 0 || a2 < 0) {
    // Unknown action names: do not move anything, say so.
    Serial.printf("{\"t\":\"ack\",\"scan_id\":%ld,\"ok\":false,\"ms\":0}\n", scanId);
    return;
  }
  unsigned long start = millis();
  servo1.write(a1);
  servo2.write(a2);
  delay(SERVO_SETTLE_MS);
  Serial.printf("{\"t\":\"ack\",\"scan_id\":%ld,\"ok\":true,\"ms\":%lu}\n", scanId, millis() - start);
}

// ---- input handling ------------------------------------------------------------------

static void handleLine(const char *json) {
  char type[16];
  if (!jsonStr(json, "t", type, sizeof(type))) return;
  if (strcmp(type, "hello?") == 0) sendHello();
  else if (strcmp(type, "ping") == 0) Serial.print("{\"t\":\"pong\"}\n");
  else if (strcmp(type, "bins?") == 0) {
    for (int i = 0; i < 8; i++) sendBin(i);
  } else if (strcmp(type, "sort") == 0) handleSort(json);
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
      else lineLen = 0;  // overlong line: drop it
    }
  }
}

static void scanSensors() {
  unsigned long now = millis();
  for (int i = 0; i < 8; i++) {
    bool full = digitalRead(BIN_PINS[i]) == BIN_FULL_LEVEL;
    if (full != binRaw[i]) {
      binRaw[i] = full;
      binChangedAt[i] = now;
    } else if (full != binState[i] && now - binChangedAt[i] >= DEBOUNCE_MS) {
      binState[i] = full;
      sendBin(i);
    }
  }
  if (MANGO_PIN >= 0) {
    bool active = digitalRead(MANGO_PIN) == MANGO_ACTIVE_LEVEL;
    if (active != mangoWasActive && now - mangoChangedAt >= DEBOUNCE_MS) {
      mangoChangedAt = now;
      mangoWasActive = active;
      if (active) Serial.print("{\"t\":\"mango\"}\n");
    }
  }
}

void setup() {
  Serial.begin(BAUD);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servo1.setPeriodHertz(50);
  servo2.setPeriodHertz(50);
  servo1.attach(SERVO1_PIN, 500, 2400);
  servo2.attach(SERVO2_PIN, 500, 2400);
  // Home position: reject group, parked slot, so a stray mango is never passed.
  servo1.write(poseAngle(SERVO1_POSES, sizeof(SERVO1_POSES) / sizeof(Pose), "group_diseased"));
  servo2.write(poseAngle(SERVO2_POSES, sizeof(SERVO2_POSES) / sizeof(Pose), "slot_park"));

  for (int i = 0; i < 8; i++) {
    pinMode(BIN_PINS[i], INPUT_PULLUP);
    binRaw[i] = binState[i] = (digitalRead(BIN_PINS[i]) == BIN_FULL_LEVEL);
    binChangedAt[i] = millis();
  }
  if (MANGO_PIN >= 0) pinMode(MANGO_PIN, INPUT_PULLUP);

  delay(300);
  sendHello();
}

void loop() {
  readSerial();
  scanSensors();
}
