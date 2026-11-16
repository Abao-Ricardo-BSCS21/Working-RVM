/*
  FilCycle machine — Arduino Uno + W5500
  Upload this file. Serial Monitor: 9600 baud.

  Wiring
    W5500 VCC  -> 5V     W5500 GND -> GND
    W5500 MOSI -> D11    W5500 MISO -> D12
    W5500 SCLK -> D13    W5500 CS   -> D10
    W5500 RST  -> 3.3V
    IR OUT     -> D4     IR VCC -> 5V    IR GND -> GND
    Inductive  -> D5     (LOW means metal)
    LCD SDA    -> A4     LCD SCL -> A5
    ULN2003 IN1 D8, IN2 D9, IN3 A0, IN4 A1

  This PC is 192.168.4.1. The Uno uses 192.168.4.50.
  npm run dev must be running. The site on the PC is http://127.0.0.1:3000
*/

#include <SPI.h>
#include <Ethernet.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Stepper.h>

#define IR_PIN         4
#define INDUCTIVE_PIN  5
#define ETH_CS_PIN     10

#define STEPPER_IN1    8
#define STEPPER_IN2    9
#define STEPPER_IN3    A0
#define STEPPER_IN4    A1

const int STEPS_PER_REV = 2048;
const int STEPS_90_DEG  = 512;

Stepper sweeperStepper(STEPS_PER_REV, STEPPER_IN1, STEPPER_IN3, STEPPER_IN2, STEPPER_IN4);
LiquidCrystal_I2C lcd(0x27, 16, 2);

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };

IPAddress arduinoIP(192, 168, 4, 50);
IPAddress dnsIP(192, 168, 4, 1);
IPAddress gatewayIP(192, 168, 4, 1);
IPAddress subnetMask(255, 255, 255, 0);
IPAddress serverIP(192, 168, 4, 1);
const uint16_t serverPort = 3000;
const char hardwareKey[] = "filcycle-dev";

// One insertion must not fire again while the sensor is still covered.
const unsigned long ITEM_COOLDOWN_MS = 3000;
const unsigned long STATUS_MS = 1000;

EthernetClient client;
unsigned long lastItemSentAt = 0;
unsigned long lastStatusAt = 0;
int irIdle = HIGH;
int lcdReady = -1;

void disableStepperCoils() {
  digitalWrite(STEPPER_IN1, LOW);
  digitalWrite(STEPPER_IN2, LOW);
  digitalWrite(STEPPER_IN3, LOW);
  digitalWrite(STEPPER_IN4, LOW);
}

void lcdLine(uint8_t row, const char* text) {
  char line[17];
  uint8_t i = 0;
  while (text[i] != '\0' && i < 16) {
    line[i] = text[i];
    i++;
  }
  while (i < 16) {
    line[i++] = ' ';
  }
  line[16] = '\0';
  lcd.setCursor(0, row);
  lcd.print(line);
}

bool linkUp() {
  return Ethernet.linkStatus() != LinkOFF;
}

bool sendItem(const char* itemType) {
  if (!linkUp()) {
    lcdLine(1, "No LAN link");
    Serial.println(F("Cable has no link"));
    return false;
  }

  lcdLine(1, "Updating Web...");
  Serial.print(F("Sending "));
  Serial.print(itemType);
  Serial.print(F(" to "));
  Serial.print(serverIP);
  Serial.print(':');
  Serial.println(serverPort);

  if (!client.connect(serverIP, serverPort)) {
    lcdLine(1, "Web Conn Error!");
    Serial.println(F("Connect failed"));
    return false;
  }

  client.print(F("GET /api/hardware/update?item="));
  client.print(itemType);
  client.print(F("&key="));
  client.print(hardwareKey);
  client.println(F(" HTTP/1.1"));
  client.print(F("Host: "));
  client.print(serverIP);
  client.print(':');
  client.println(serverPort);
  client.println(F("Connection: close"));
  client.println();

  unsigned long started = millis();
  while (client.connected() && millis() - started < 2500) {
    while (client.available()) {
      Serial.write(client.read());
    }
  }
  Serial.println();
  client.stop();

  lcdLine(1, "Web Updated!");
  return true;
}

void divert(bool metal) {
  if (metal) {
    lcdLine(0, "Sorted: TIN CAN");
    sweeperStepper.step(STEPS_90_DEG);
    delay(400);
    sweeperStepper.step(-STEPS_90_DEG);
  } else {
    lcdLine(0, "Sorted: BOTTLE");
    sweeperStepper.step(-STEPS_90_DEG);
    delay(400);
    sweeperStepper.step(STEPS_90_DEG);
  }
  disableStepperCoils();
}

void learnIrIdle() {
  int highCount = 0;
  for (int i = 0; i < 20; i++) {
    if (digitalRead(IR_PIN) == HIGH) {
      highCount++;
    }
    delay(25);
  }
  irIdle = (highCount >= 10) ? HIGH : LOW;
  Serial.print(F("IR idle is "));
  Serial.println(irIdle == HIGH ? F("HIGH") : F("LOW"));
  Serial.println(F("Keep the sensor clear while the board starts."));
}

bool itemPresent() {
  return digitalRead(IR_PIN) != irIdle;
}

void showIdleScreen() {
  if (lcdReady == 1) {
    lcdLine(0, "Ready");
    lcdLine(1, "Insert bottle");
  } else if (lcdReady == 0) {
    lcdLine(0, "Scan barcode");
    lcdLine(1, "");
  }
}

int fetchReady() {
  if (!linkUp() || !client.connect(serverIP, serverPort)) {
    return -1;
  }

  client.print(F("GET /api/hardware/update?item=STATUS&key="));
  client.print(hardwareKey);
  client.println(F(" HTTP/1.1"));
  client.print(F("Host: "));
  client.print(serverIP);
  client.print(':');
  client.println(serverPort);
  client.println(F("Connection: close"));
  client.println();

  const char needle[] = "ready\":1";
  uint8_t matched = 0;
  bool ready = false;
  unsigned long started = millis();
  while (client.connected() && millis() - started < 1500) {
    while (client.available()) {
      char c = client.read();
      if (c == needle[matched]) {
        matched++;
        if (needle[matched] == '\0') {
          ready = true;
        }
      } else {
        matched = (c == needle[0]) ? 1 : 0;
      }
    }
  }
  client.stop();
  return ready ? 1 : 0;
}

void pollSession() {
  if (millis() - lastStatusAt < STATUS_MS) {
    return;
  }
  lastStatusAt = millis();

  if (!linkUp()) {
    if (lcdReady != -2) {
      lcdReady = -2;
      lcdLine(0, "Ready");
      lcdLine(1, "No LAN link");
    }
    return;
  }

  int ready = fetchReady();
  if (ready < 0 || ready == lcdReady) {
    return;
  }
  lcdReady = ready;
  Serial.println(ready == 1 ? F("Barcode ready") : F("Waiting for barcode"));
  showIdleScreen();
}

void setup() {
  pinMode(IR_PIN, INPUT);
  pinMode(INDUCTIVE_PIN, INPUT_PULLUP);

  sweeperStepper.setSpeed(12);
  disableStepperCoils();

  Serial.begin(9600);
  delay(300);
  Wire.begin();
  lcd.init();
  lcd.backlight();
  lcdLine(0, "Connecting LAN..");

  Ethernet.init(ETH_CS_PIN);
  Ethernet.begin(mac, arduinoIP, dnsIP, gatewayIP, subnetMask);
  delay(1000);

  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    lcdLine(1, "W5500 Error!");
    Serial.println(F("W5500 not detected. Check 5V, GND, D10-D13."));
    while (true) {
      delay(1000);
    }
  }

  learnIrIdle();

  Serial.print(F("Arduino IP: "));
  Serial.println(Ethernet.localIP());
  lcdLine(1, "192.168.4.50");
  delay(1200);
  lcdReady = linkUp() ? 0 : -2;
  showIdleScreen();
  if (lcdReady == -2) {
    lcdLine(0, "Ready");
    lcdLine(1, "No LAN link");
  }
}

void loop() {
  if (!itemPresent()) {
    pollSession();
  }

  if (Serial.available()) {
    char command = Serial.read();
    if (command == 'B' || command == 'b') {
      divert(false);
      sendItem("BOTTLE");
      lastItemSentAt = millis();
    } else if (command == 'C' || command == 'c') {
      divert(true);
      sendItem("CAN");
      lastItemSentAt = millis();
    }
  }

  if (!itemPresent()) {
    return;
  }
  if (millis() - lastItemSentAt < ITEM_COOLDOWN_MS) {
    return;
  }
  delay(80);
  if (!itemPresent()) {
    return;
  }

  bool metalDetected = (digitalRead(INDUCTIVE_PIN) == LOW);
  Serial.println(metalDetected ? F("Item seen: CAN") : F("Item seen: BOTTLE"));
  divert(metalDetected);
  sendItem(metalDetected ? "CAN" : "BOTTLE");
  lastItemSentAt = millis();

  while (itemPresent()) {
    delay(20);
  }
  delay(300);
  showIdleScreen();
}
