/*
 * MangoScan controller (ESP32 dev board)
 *
 * Moves the two sorting servos on command (through a PCA9685 servo driver), reports when a
 * bin is full (ultrasonic sensors), and optionally tells the laptop that a mango has arrived
 * at the camera station.
 *
 * Talks to the laptop over the USB cable as one JSON object per line.
 * See Firmware/README.md for the protocol, wiring and calibration.
 *
 * Library needed: "Adafruit PWM Servo Driver Library" (Arduino Library Manager).
 * Board: "ESP32 Dev Module".
 */
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include "bin_level.h"

// ----------------------------------------------------------------------------
// CONFIGURE FOR YOUR WIRING
// ----------------------------------------------------------------------------
static const char *DEVICE_ID = "ctrl-1";
// The USB link on the first rig failed above 115200 baud. Must match SERIAL_BAUD on the laptop.
static const unsigned long BAUD = 115200;

// Servo driver: PCA9685 on I2C. Found by scan at SDA 21 / SCL 22, address 0x40.
static const int SDA_PIN = 21;
static const int SCL_PIN = 22;
static const uint8_t PCA_ADDR = 0x40;
static const int SERVO1_CH = 0;  // PLACEHOLDER: selects the group: green, yellow, diseased, bruised
static const int SERVO2_CH = 1;  // PLACEHOLDER: selects the slot: small, medium, large, park
static const int SERVO_MIN_US = 500;   // pulse for 0 degrees
static const int SERVO_MAX_US = 2400;  // pulse for 180 degrees
// Move to the reject/park pose at power-up. Leave false until the angles below are calibrated,
// otherwise an uncalibrated pose could drive the mechanism into a stop.
static const bool MOVE_TO_HOME_AT_BOOT = false;

// Bin-full sensors (ultrasonic, mounted above each bin looking down), in bin order:
// 1 Diseased, 2 Bruised, 3 Green Small, 4 Yellow Small, 5 Green Medium, 6 Yellow Medium,
// 7 Green Large, 8 Yellow Large. -1 means no sensor installed for that bin.
static const int TRIG_PINS[8] = {16, -1, -1, -1, -1, -1, -1, -1};
static const int ECHO_PINS[8] = {26, -1, -1, -1, -1, -1, -1, -1};
static const int FULL_CM = 8;            // PLACEHOLDER: full when the fruit is this close to the sensor
static const int CLEAR_MARGIN_CM = 3;    // ... and not full again until it is FULL_CM + this far
static const uint8_t CONFIRM_READINGS = 3;
static const unsigned long ECHO_TIMEOUT_US = 12000;  // about 2 m; no echo by then
static const unsigned long PING_INTERVAL_MS = 60;    // one sensor is pinged per interval

// Mango-arrived sensor (IR break beam etc.). Set to -1 if there is none.
static const int MANGO_PIN = -1;
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

Adafruit_PWMServoDriver pwm(PCA_ADDR);
static bool servoDriverOk = false;

#define NEW_LEVEL BinLevel(FULL_CM, CLEAR_MARGIN_CM, CONFIRM_READINGS)
static BinLevel levels[8] = {NEW_LEVEL, NEW_LEVEL, NEW_LEVEL, NEW_LEVEL, NEW_LEVEL, NEW_LEVEL, NEW_LEVEL, NEW_LEVEL};
static int nextSensor = 0;
static unsigned long lastPingAt = 0;

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
  Serial.printf("{\"t\":\"hello\",\"id\":\"%s\",\"caps\":[\"servo\",\"bins\"%s],\"fw\":\"1.2\"}\n", DEVICE_ID,
                MANGO_PIN >= 0 ? ",\"mango\"" : "");
}

static void sendBin(int index) {
  Serial.printf("{\"t\":\"bin\",\"bin\":%d,\"full\":%s}\n", index + 1, levels[index].full ? "true" : "false");
}

// ---- ultrasonic sensors ----------------------------------------------------------

static bool hasSensor(int i) { return TRIG_PINS[i] >= 0 && ECHO_PINS[i] >= 0; }

// Distance in whole cm, or -1 when no echo came back.
static int readCm(int i) {
  digitalWrite(TRIG_PINS[i], LOW);
  delayMicroseconds(3);
  digitalWrite(TRIG_PINS[i], HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PINS[i], LOW);
  unsigned long us = pulseIn(ECHO_PINS[i], HIGH, ECHO_TIMEOUT_US);
  return us == 0 ? -1 : (int)(us / 58);
}

static void sendDistances() {
  Serial.print("{\"t\":\"dist\",\"cm\":[");
  for (int i = 0; i < 8; i++) {
    if (i) Serial.print(',');
    if (hasSensor(i)) Serial.print(readCm(i));
    else Serial.print("null");
  }
  Serial.print("]}\n");
}

// Ping the next installed sensor once per interval and report any change.
static void pingNext() {
  unsigned long now = millis();
  if (now - lastPingAt < PING_INTERVAL_MS) return;
  for (int n = 0; n < 8; n++) {
    int i = (nextSensor + n) % 8;
    if (!hasSensor(i)) continue;
    lastPingAt = now;
    nextSensor = (i + 1) % 8;
    if (levels[i].update(readCm(i))) sendBin(i);
    return;
  }
}

// ---- servo handling ------------------------------------------------------------

static int poseAngle(const Pose *poses, size_t count, const char *name) {
  for (size_t i = 0; i < count; i++) {
    if (strcmp(poses[i].name, name) == 0) return poses[i].angle;
  }
  return -1;
}

static void moveServo(int channel, int degrees) {
  int us = SERVO_MIN_US + (long)(SERVO_MAX_US - SERVO_MIN_US) * constrain(degrees, 0, 180) / 180;
  pwm.writeMicroseconds(channel, us);
}

static void handleSort(const char *json) {
  long scanId = jsonInt(json, "scan_id", -1);
  char s1[32], s2[32];
  int a1 = -1, a2 = -1;
  if (jsonStr(json, "s1", s1, sizeof(s1))) a1 = poseAngle(SERVO1_POSES, sizeof(SERVO1_POSES) / sizeof(Pose), s1);
  if (jsonStr(json, "s2", s2, sizeof(s2))) a2 = poseAngle(SERVO2_POSES, sizeof(SERVO2_POSES) / sizeof(Pose), s2);

  if (scanId < 0 || a1 < 0 || a2 < 0 || !servoDriverOk) {
    // Unknown action names or no servo driver: do not move anything, say so.
    Serial.printf("{\"t\":\"ack\",\"scan_id\":%ld,\"ok\":false,\"ms\":0}\n", scanId);
    return;
  }
  unsigned long start = millis();
  moveServo(SERVO1_CH, a1);
  moveServo(SERVO2_CH, a2);
  delay(SERVO_SETTLE_MS);
  Serial.printf("{\"t\":\"ack\",\"scan_id\":%ld,\"ok\":true,\"ms\":%lu}\n", scanId, millis() - start);
}

// Calibration helper: {"t":"jog","ch":0,"deg":90} moves one servo-driver channel. Use it with the
// MangoScan server stopped, to find which channel is which and which angles line up with the bins.
static void handleJog(const char *json) {
  long ch = jsonInt(json, "ch", -1);
  long deg = jsonInt(json, "deg", -1);
  bool ok = servoDriverOk && ch >= 0 && ch <= 15 && deg >= 0 && deg <= 180;
  if (ok) moveServo((int)ch, (int)deg);
  Serial.printf("{\"t\":\"jog\",\"ok\":%s,\"ch\":%ld,\"deg\":%ld}\n", ok ? "true" : "false", ch, deg);
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
  else if (strcmp(type, "dist?") == 0) sendDistances();
  else if (strcmp(type, "jog") == 0) handleJog(json);
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

static void scanMango() {
  if (MANGO_PIN < 0) return;
  unsigned long now = millis();
  bool active = digitalRead(MANGO_PIN) == MANGO_ACTIVE_LEVEL;
  if (active != mangoWasActive && now - mangoChangedAt >= DEBOUNCE_MS) {
    mangoChangedAt = now;
    mangoWasActive = active;
    if (active) Serial.print("{\"t\":\"mango\"}\n");
  }
}

void setup() {
  Serial.begin(BAUD);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.beginTransmission(PCA_ADDR);
  servoDriverOk = Wire.endTransmission() == 0;
  if (servoDriverOk) {
    pwm.begin();
    pwm.setOscillatorFrequency(27000000);
    pwm.setPWMFreq(50);
    if (MOVE_TO_HOME_AT_BOOT) {
      // Home position: reject group, parked slot, so a stray mango is never passed.
      moveServo(SERVO1_CH, poseAngle(SERVO1_POSES, sizeof(SERVO1_POSES) / sizeof(Pose), "group_diseased"));
      moveServo(SERVO2_CH, poseAngle(SERVO2_POSES, sizeof(SERVO2_POSES) / sizeof(Pose), "slot_park"));
    }
  }

  for (int i = 0; i < 8; i++) {
    if (!hasSensor(i)) continue;
    pinMode(TRIG_PINS[i], OUTPUT);
    digitalWrite(TRIG_PINS[i], LOW);
    pinMode(ECHO_PINS[i], INPUT);
  }
  if (MANGO_PIN >= 0) pinMode(MANGO_PIN, INPUT_PULLUP);

  delay(300);
  sendHello();
}

void loop() {
  readSerial();
  pingNext();
  scanMango();
}
