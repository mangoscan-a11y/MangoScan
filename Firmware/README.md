# MangoScan firmware

Two Arduino sketches. Each ESP32 talks to the laptop over its own **USB cable**, one JSON message per line. Nothing uses WiFi.

| Sketch | Board | Job |
|---|---|---|
| `mangoscan_controller/` | ESP32 dev board | Moves the 2 sorting servos, reports full bins, reports "mango arrived" |
| `mangoscan_camera/` | AI-Thinker ESP32-CAM (with its USB programmer base) | Takes a photo when asked and sends it back |

## One-time setup (needs internet, do it beforehand)

1. Install **Arduino IDE 2**.
2. *File > Preferences > Additional boards manager URLs*, add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
3. *Boards Manager*, install **esp32 by Espressif Systems** (3.x).
4. *Library Manager*, install **ESP32Servo** (controller only).
5. Open a sketch, pick the board, pick the COM port, press Upload.
   * Controller: board **ESP32 Dev Module**.
   * Camera: board **AI Thinker ESP32-CAM**. If the upload hangs on "Connecting...", hold the board's IO0/BOOT button while it starts, then release.

Both sketches compile cleanly against esp32 core 3.3.12 (controller as ESP32 Dev Module, camera as AI Thinker ESP32-CAM). They have **not yet been run on real hardware**, so expect to calibrate pins and servo angles on the first power-up.

## Wiring (controller)

Defaults are at the top of the sketch. Change them to match your build.

| Function | GPIO | Notes |
|---|---|---|
| Servo 1 (group) | 18 | Power servos from a separate 5 V supply, share its GND with the ESP32 |
| Servo 2 (slot) | 19 | same |
| Bin 1..8 full sensors | 32, 33, 25, 26, 27, 14, 13, 4 | Switch between pin and GND. Closed = bin full. Flip `BIN_FULL_LEVEL` for the opposite |
| Mango arrived sensor | 15 | Optional. Set `MANGO_PIN` to `-1` if you have none |

## Calibrating the servos

`SERVO1_POSES` and `SERVO2_POSES` map the names the routing config uses (`group_green`, `slot_medium`, ...) to angles. **The numbers shipped are placeholders.** Adjust until each bin position lines up on the real machine. The names must stay as they are: they come from `MyTasks/model5_fusion/config/routing.toml`.

A command for an unknown name is refused (`ok:false`) and nothing moves.

## Camera angles

`ANGLES` in the camera sketch lists the angle numbers (1..9) this board can deliver. One camera that sees the mango from 5 positions keeps `{1,2,3,4,5}`. With one camera per angle, flash each board with its own single number and give each a different `DEVICE_ID`. The server asks every camera for its own angles and merges the photos.

## Protocol

UTF-8 lines of JSON, `\n` terminated, 921600 baud. The server tolerates boot-log noise on the line.

| Direction | Message |
|---|---|
| server to device | `{"t":"hello?"}` (repeated until answered) |
| device to server | `{"t":"hello","id":"ctrl-1","caps":["servo","bins","mango"],"fw":"1.0"}` or `{"t":"hello","id":"cam-1","caps":["camera"],"angles":[1,2,3,4,5]}` |
| server to controller | `{"t":"sort","scan_id":42,"bin":2,"s1":"group_green","s2":"slot_medium"}` |
| controller to server | `{"t":"ack","scan_id":42,"ok":true,"ms":410}` |
| controller to server | `{"t":"bin","bin":3,"full":true}` (on every change) |
| server to controller | `{"t":"bins?"}` (answered with one `bin` line per bin) |
| controller to server | `{"t":"mango"}` (arrival sensor) |
| server to camera | `{"t":"capture","scan_id":42,"angle":1}` |
| camera to server | `{"t":"img","scan_id":42,"angle":1,"len":23456}` then **exactly `len` raw JPEG bytes** |
| camera to server | `{"t":"err","scan_id":42,"angle":1,"msg":"capture failed"}` |
| either | `{"t":"ping"}` answered by `{"t":"pong"}` |

## Testing a board by hand

Close the MangoScan server first (a COM port can only be open in one program). Open the Arduino Serial Monitor at **921600 baud**, line ending **Newline**, and type:

```
{"t":"hello?"}
{"t":"bins?"}
{"t":"sort","scan_id":1,"bin":2,"s1":"group_green","s2":"slot_medium"}
```

## Troubleshooting

* **Server says the port is busy / access denied**: the Serial Monitor (or another program) still has the COM port.
* **Board is not detected**: check the cable carries data (not charge-only) and that the driver for the CP210x / CH340 chip is installed.
* **Camera answers `camera init failed`**: the ESP32-CAM needs a solid 5 V supply. USB hubs often brown it out. Use a direct port or an external 5 V supply.
* **Garbage in photos**: the camera sketch silences the driver log on purpose. If you add `Serial.print` debugging, the text lands inside the image data.
