# MangoScan firmware

Two Arduino sketches. Each ESP32 talks to the laptop over its own **USB cable**, one JSON message per line. Nothing uses WiFi.

| Sketch | Board | Job |
|---|---|---|
| `mangoscan_controller/` | ESP32 dev board (WROOM) | Moves the 2 sorting servos through a PCA9685 servo driver, reports full bins from ultrasonic sensors, reports "mango arrived" |
| `mangoscan_camera/` | ESP32-S3 + OV5640 (the rig's board), or an AI-Thinker ESP32-CAM with its USB programmer base | Takes a photo when asked and sends it back |

## One-time setup (needs internet, do it beforehand)

1. Install **Arduino IDE 2**.
2. *File > Preferences > Additional boards manager URLs*, add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
3. *Boards Manager*, install **esp32 by Espressif Systems** (3.x).
4. *Library Manager*, install **Adafruit PWM Servo Driver Library** (controller only).
5. Open a sketch, pick the board, pick the COM port, press Upload.
   * Controller: board **ESP32 Dev Module**.
   * Camera, ESP32-S3 + OV5640 (default in the sketch, `CAMERA_BOARD`): board **ESP32S3 Dev Module**, *PSRAM* **OPI PSRAM**, *Flash Size* **16MB**, *USB CDC On Boot* **Disabled**. Plug the USB-C port that has the serial chip (it shows up as a CH343 COM port); the other port is the chip's native USB and is not used.
   * Camera, AI-Thinker: set `CAMERA_BOARD` to `BOARD_AI_THINKER` and pick board **AI Thinker ESP32-CAM**. If the upload hangs on "Connecting...", hold the board's IO0/BOOT button while it starts, then release.

Both sketches compile cleanly against esp32 core 3.3.12 (controller as ESP32 Dev Module, camera for both boards).

**Status.** The controller has run on a real ESP32 (2026-10-14): the server finds it and the whole protocol below answers correctly. Still to do on the rig: servo channels and angles, and the ultrasonic sensor (it returned no echo on GPIO 16/26 in testing, check its power and wiring). The camera has run on the real ESP32-S3 + OV5640: the server finds it and photos arrive in about 0.3 s. Its pin map was found by probing (XCLK 15, SDA 4, SCL 5, D0-D7 on 11, 9, 8, 10, 12, 18, 17, 16, VSYNC 6, HREF 7, PCLK 13). The first test photo was rotated 90 degrees, dark and out of focus, so check orientation and focus once the camera is mounted.

**Upload speed.** The controller's CP2102 USB link failed above 115200 baud, so upload to it at 115200 (Arduino IDE: *Tools > Upload Speed*). The camera board's CH343 link works at 921600. A bad cable or a hub is the usual cause of a link that fails at high speed; try a short data cable straight into the laptop.

## Wiring (controller)

Defaults are at the top of the sketch. Change them to match your build.

| Function | GPIO | Notes |
|---|---|---|
| Servo driver (PCA9685, I2C address 0x40) | SDA 21, SCL 22 | Found by scanning the board. Power the servos from the driver's own 5 V supply and share its GND with the ESP32 |
| Servo 1 (group) | driver channel `SERVO1_CH` (0) | **Placeholder, confirm.** Selects green, yellow, diseased or bruised |
| Servo 2 (slot) | driver channel `SERVO2_CH` (1) | **Placeholder, confirm.** Selects small, medium, large or park |
| Bin 1..8 level sensors (1 Diseased, 2 Bruised, 3 Green Small, 4 Yellow Small, 5 Green Medium, 6 Yellow Medium, 7 Green Large, 8 Yellow Large) | `TRIG_PINS` / `ECHO_PINS` | Ultrasonic (HC-SR04 style), mounted above each bin looking down. Bin 1: trigger 16, echo 26. `-1` = no sensor installed (bins 2-8 today). A 5 V sensor's echo output needs a voltage divider (the ESP32 is 3.3 V), or use a 3.3 V sensor |
| Mango arrived sensor | `MANGO_PIN` (-1) | Optional. Not installed, so the controller does not advertise the `mango` capability |

A bin counts as full when the fruit is `FULL_CM` (8, **placeholder**) or closer to its sensor, confirmed by 3 readings in a row (also for a sensor's very first reading, so one stray echo cannot raise a false alarm), and it clears once the distance exceeds `FULL_CM + CLEAR_MARGIN_CM` (3). A sensor that returns no echo is treated as "unknown": the last state is kept and no event is sent. The logic lives in `bin_level.h`.

The servos do **not** move at power-up (`MOVE_TO_HOME_AT_BOOT` is `false`) until the angles are calibrated.

## Calibrating the servos

`SERVO1_POSES` and `SERVO2_POSES` map the names the routing config uses (`group_green`, `slot_medium`, ...) to angles. **The numbers shipped are placeholders.** Adjust until each bin position lines up on the real machine. The names must stay as they are: they come from `MyTasks/model5_fusion/config/routing.toml`.

A command for an unknown name is refused (`ok:false`) and nothing moves.

To find the channels and angles without reflashing, close the server and type these in a serial monitor (115200 baud, line ending Newline). `jog` moves one servo-driver channel straight to an angle, so start with small, careful steps and keep the mechanism clear:

```
{"t":"jog","ch":0,"deg":90}      -> {"t":"jog","ok":true,"ch":0,"deg":90}
{"t":"dist?"}                    -> {"t":"dist","cm":[23,null,null,null,null,null,null,null]}
```

`dist?` shows the live distance for each installed sensor (`-1` = no echo, `null` = no sensor for that bin). Use it to choose `FULL_CM`: read the distance with the bin empty and with fruit piled to the level you call full.

## Camera angles

`ANGLES` in the camera sketch lists the angle numbers (1..9) this board can deliver. One camera that sees the mango from 5 positions keeps `{1,2,3,4,5}`. With one camera per angle, flash each board with its own single number and give each a different `DEVICE_ID`. The server asks every camera for its own angles and merges the photos.

## Protocol

UTF-8 lines of JSON, `\n` terminated. The controller uses **115200 baud** and the camera **921600** (a photo is 20-40 KB and the server gives up on a capture after 2 s, so the camera cannot run at 115200). `npm run up` sets `SERIAL_ADAPTER_BAUDS=10c4:115200`, which gives boards behind a CP210x adapter 115200 and everything else the default 921600. If the boards sit behind other adapters, set `SERIAL_ADAPTER_BAUDS` yourself or use explicit per-port speeds, e.g. `SERIAL_PORTS=COM3:115200,COM4:921600`. The server tolerates boot-log noise on the line.

| Direction | Message |
|---|---|
| server to device | `{"t":"hello?"}` (repeated until answered) |
| device to server | `{"t":"hello","id":"ctrl-1","caps":["servo","bins","mango"],"fw":"1.0"}` or `{"t":"hello","id":"cam-1","caps":["camera"],"angles":[1,2,3,4,5]}` |
| server to controller | `{"t":"sort","scan_id":42,"bin":5,"s1":"group_green","s2":"slot_medium"}` |
| controller to server | `{"t":"ack","scan_id":42,"ok":true,"ms":410}` |
| controller to server | `{"t":"bin","bin":3,"full":true}` (on every change) |
| server to controller | `{"t":"bins?"}` (answered with one `bin` line per bin) |
| controller to server | `{"t":"mango"}` (arrival sensor) |
| server to camera | `{"t":"capture","scan_id":42,"angle":1}` |
| camera to server | `{"t":"img","scan_id":42,"angle":1,"len":23456}` then **exactly `len` raw JPEG bytes** |
| camera to server | `{"t":"err","scan_id":42,"angle":1,"msg":"capture failed"}` |
| either | `{"t":"ping"}` answered by `{"t":"pong"}` |

## Testing a board by hand

Close the MangoScan server first (a COM port can only be open in one program). Open the Arduino Serial Monitor at **115200 baud** (controller), line ending **Newline**, and type:

```
{"t":"hello?"}
{"t":"bins?"}
{"t":"sort","scan_id":1,"bin":5,"s1":"group_green","s2":"slot_medium"}
```

## Troubleshooting

* **Server says the port is busy / access denied**: the Serial Monitor (or another program) still has the COM port.
* **Board is not detected**: check the cable carries data (not charge-only) and that the driver for the CP210x / CH340 chip is installed.
* **Camera answers `camera init failed`**: the ESP32-CAM needs a solid 5 V supply. USB hubs often brown it out. Use a direct port or an external 5 V supply.
* **Garbage in photos**: the camera sketch silences the driver log on purpose. If you add `Serial.print` debugging, the text lands inside the image data.
