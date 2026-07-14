/**********************************************************************
 *  HW-SELBSTTEST  –  Modellboot (LILYGO T-A7670G R2 / ESP32-WROVER-E)
 *
 *  Testet in jedem Loop-Zyklus alle Komponenten der Reihe nach:
 *    - PCA9685  Ausgänge 0..7      (walking output test)
 *    - Servo    (GPIO18)  + ESC (GPIO25)
 *    - INA226   Spannung + Strom
 *    - ADS1115  Analog A0..A3  (alle Analogeingaenge)
 *    - BMP280   Temp + Druck
 *    - LSM9DS1  IMU (Accel/Gyro/Mag)
 *    - GPS      (u-blox M8N, Serial2)
 *    - PPM      (Radiolink R12DSM, GPIO34, interrupt-getrieben)
 *
 *  Ein fehlendes Gerät blockiert NICHTS – der jeweilige Test meldet
 *  FAIL / n/a, der Rest läuft weiter.
 *
 *  Arduino-Core 3.x  (ledcAttach/ledcWrite).  Nur zum Testen gedacht.
 *********************************************************************/

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_ADS1X15.h>
#include <SparkFunLSM9DS1.h>
#include <INA226.h>
#include <TinyGPSPlus.h>

// ===================================================================
//  KONFIGURATION  –  hier bei Bedarf anpassen
// ===================================================================

// ---- I2C Bus1 (zeitkritisch: IMU) ----
#define BUS1_SDA        19
#define BUS1_SCL        23
#define ADDR_IMU_AG     0x6B
#define ADDR_IMU_M      0x1E

// ---- I2C Bus2 (Peripherie) ----
#define BUS2_SDA        32
#define BUS2_SCL        33
#define ADDR_BMP280     0x76      // 0x77 = alt (SDO high)
#define ADDR_INA226     0x45      // real gemessen (A1=VS, A0=VS)
#define ADDR_PCA9685    0x40
#define ADDR_ADS1115    0x48      // Default; ggf. anpassen

// ---- PCA9685 (LED-/Output-Treiber) ----
#define PCA_OE_PIN      5         // active LOW, 10k pull-up nach 3V3
#define PCA_FREQ        1000      // Hz (generische Ausgänge)
#define PCA_CH_COUNT    8         // Kanäle 0..7

// ---- Servo / ESC (LEDC) ----
#define SERVO_PIN       18
#define ESC_PIN         25
#define PWM_FREQ        50        // Hz
#define PWM_RES_BITS    16
#define ESC_MOTOR_TEST  0         // 0 = nur armen+idle | 1 = leichter Gasstoss (!! Schraube ab !!)
#define SERVO_CH        0         // LEDC-Kanal (nur Core 2.x)
#define ESC_CH          1         // LEDC-Kanal (nur Core 2.x)

// ---- INA226 Shunt (an deinen realen Busbar-Shunt anpassen!) ----
#define INA_MAX_CURRENT 25.0      // A
#define INA_SHUNT_OHM   0.003     // <= 3.2768 mOhm fuer 25A / 81.92mV

// ---- GPS (u-blox M8N, Serial2) ----
#define GPS_RX_PIN      21        // ESP RX  <- GPS TX
#define GPS_TX_PIN      22        // ESP TX  -> GPS RX
#define GPS_BAUD        9600

// ---- PPM (Radiolink R12DSM) ----
#define PPM_PIN         34        // input-only, RX treibt den Pin
#define PPM_MAX_CH      12        // max. erwartete Kanaele
#define PPM_SYNC_US     3000      // Luecke > 3ms = Frame-Sync
#define PPM_EDGE        RISING    // pos. PPM; bei negativem -> FALLING

// ===================================================================
//  Objekte
// ===================================================================
Adafruit_PWMServoDriver pca(ADDR_PCA9685, Wire1);
Adafruit_BMP280         bmp(&Wire1);
Adafruit_ADS1115        ads;
LSM9DS1                 imu;
INA226                  ina(ADDR_INA226, &Wire1);
TinyGPSPlus             gps;

// ---- Present-Flags (Init-Status) ----
bool ok_pca = false, ok_bmp = false, ok_ads = false;
bool ok_imu = false, ok_ina = false;

// ---- PPM (interrupt-getrieben) ----
volatile uint16_t ppmCh[PPM_MAX_CH] = {0};
volatile uint8_t  ppmChCount   = 0;      // Kanaele im letzten Frame
volatile uint8_t  ppmIdx       = 0;
volatile uint32_t ppmLastEdge  = 0;
volatile uint32_t ppmFrameCount = 0;

void IRAM_ATTR ppmISR() {
  uint32_t now = micros();
  uint32_t d   = now - ppmLastEdge;
  ppmLastEdge  = now;
  if (d > PPM_SYNC_US) {                  // Sync-Luecke -> Frame-Ende
    ppmChCount = ppmIdx;
    ppmIdx     = 0;
    ppmFrameCount++;
  } else if (ppmIdx < PPM_MAX_CH) {       // Kanal-Puls
    ppmCh[ppmIdx++] = (uint16_t)d;
  }
}

// ===================================================================
//  Helpers
// ===================================================================

// GPS waehrend Wartezeiten weiterfuettern (klassisches TinyGPS-Pattern)
static void smartDelay(uint32_t ms) {
  uint32_t start = millis();
  do {
    while (Serial2.available()) gps.encode(Serial2.read());
  } while (millis() - start < ms);
}

// Servo/ESC: Mikrosekunden -> LEDC-Duty (16 bit @ 50 Hz)
static inline void writeMicroseconds(uint8_t pin, uint16_t us) {
  const uint32_t maxDuty = (1UL << PWM_RES_BITS) - 1;   // 65535
  uint32_t duty = (uint32_t)((float)us / 20000.0f * maxDuty);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);                                 // Core 3.x: per Pin
#else
  ledcWrite(pin == SERVO_PIN ? SERVO_CH : ESC_CH, duty);// Core 2.x: per Kanal
#endif
}

// I2C-Scan auf beliebigem Bus
static void i2cScan(TwoWire &bus, const char *name) {
  Serial.printf("  I2C-Scan %s: ", name);
  uint8_t found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    bus.beginTransmission(a);
    if (bus.endTransmission() == 0) {
      Serial.printf("0x%02X ", a);
      found++;
    }
  }
  if (!found) Serial.print("(keine)");
  Serial.println();
}

#define TAG(ok) ((ok) ? "OK  " : "FAIL")

// ===================================================================
//  SETUP
// ===================================================================
void setup() {
  // OE des PCA9685 SOFORT deaktivieren (Ausgaenge aus waehrend Boot)
  pinMode(PCA_OE_PIN, OUTPUT);
  digitalWrite(PCA_OE_PIN, HIGH);   // HIGH = disabled

  Serial.begin(115200);
  delay(300);
  Serial.println("\n\n======================================");
  Serial.println("   HW-SELBSTTEST  –  Modellboot");
  Serial.println("======================================");

  // ---- I2C Busse ----
  Wire.begin(BUS1_SDA, BUS1_SCL);       // Bus1: IMU
  Wire1.begin(BUS2_SDA, BUS2_SCL);      // Bus2: Peripherie
  Wire.setClock(400000);
  Wire1.setClock(400000);

  i2cScan(Wire,  "Bus1");
  i2cScan(Wire1, "Bus2");
  Serial.println("--------------------------------------");

  // ---- GPS ----
  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // ---- PPM ----
  pinMode(PPM_PIN, INPUT);                // GPIO34: kein interner Pull-up
  ppmLastEdge = micros();
  attachInterrupt(digitalPinToInterrupt(PPM_PIN), ppmISR, PPM_EDGE);
  Serial.println("  PPM      : ISR aktiv (GPIO34)");

  // ---- PCA9685 ----
  ok_pca = pca.begin();
  if (ok_pca) {
    pca.setPWMFreq(PCA_FREQ);
    for (uint8_t c = 0; c < 16; c++) pca.setPWM(c, 0, 0);  // alles aus
    digitalWrite(PCA_OE_PIN, LOW);      // Ausgaenge freigeben
  }
  Serial.printf("  PCA9685  : %s\n", TAG(ok_pca));

  // ---- Servo / ESC (LEDC) ----
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(SERVO_PIN, PWM_FREQ, PWM_RES_BITS);
  ledcAttach(ESC_PIN,   PWM_FREQ, PWM_RES_BITS);
#else
  ledcSetup(SERVO_CH, PWM_FREQ, PWM_RES_BITS);
  ledcAttachPin(SERVO_PIN, SERVO_CH);
  ledcSetup(ESC_CH,   PWM_FREQ, PWM_RES_BITS);
  ledcAttachPin(ESC_PIN,   ESC_CH);
#endif
  writeMicroseconds(SERVO_PIN, 1500);   // Mitte
  writeMicroseconds(ESC_PIN,   1500);   // Testservo Mitte
  Serial.println("  Servo/ESC-Out: init (Mitte)");

  // ---- INA226 ----
  ok_ina = ina.begin();
  if (ok_ina) ina.setMaxCurrentShunt(INA_MAX_CURRENT, INA_SHUNT_OHM);
  Serial.printf("  INA226   : %s\n", TAG(ok_ina));

  // ---- ADS1115 ----
  ok_ads = ads.begin(ADDR_ADS1115, &Wire1);
  if (ok_ads) ads.setGain(GAIN_ONE);    // +/-4.096V
  Serial.printf("  ADS1115  : %s\n", TAG(ok_ads));

  // ---- BMP280 ----
  ok_bmp = bmp.begin(ADDR_BMP280);
  Serial.printf("  BMP280   : %s\n", TAG(ok_bmp));

  // ---- IMU (Bus1 = Wire) ----
  ok_imu = imu.begin(ADDR_IMU_AG, ADDR_IMU_M, Wire);
  Serial.printf("  LSM9DS1  : %s\n", TAG(ok_imu));

  Serial.println("======================================");
  Serial.println(" Init fertig – starte Dauertest\n");
}

// ===================================================================
//  Einzeltests
// ===================================================================

void testPower() {
  Serial.println("[ SPANNUNG / STROM ]");
  if (ok_ina) {
    Serial.printf("  Bus     : %7.3f V\n", ina.getBusVoltage());
    Serial.printf("  Strom   : %7.3f A\n", ina.getCurrent());
    Serial.printf("  Leistung: %7.3f W\n", ina.getPower());
    Serial.printf("  Shunt   : %7.3f mV\n", ina.getShuntVoltage_mV());
  } else {
    Serial.println("  INA226 n/a");
  }
}

void testAnalog() {
  Serial.println("[ ANALOG-EINGAENGE A0..A3 (ADS1115) ]");
  if (ok_ads) {
    for (uint8_t ch = 0; ch < 4; ch++) {
      int16_t raw = ads.readADC_SingleEnded(ch);
      Serial.printf("  ADS A%u  : %6d raw  %6.3f V\n",
                    ch, raw, ads.computeVolts(raw));
    }
  } else {
    Serial.println("  ADS1115 A0..A3 n/a");
  }
}

void testBaro() {
  Serial.println("[ BMP280 ]");
  if (ok_bmp) {
    Serial.printf("  Temp    : %7.2f C\n", bmp.readTemperature());
    Serial.printf("  Druck   : %7.2f hPa\n", bmp.readPressure() / 100.0f);
  } else {
    Serial.println("  BMP280 n/a");
  }
}

void testImu() {
  Serial.println("[ LSM9DS1 IMU ]");
  if (!ok_imu) { Serial.println("  IMU n/a"); return; }
  if (imu.accelAvailable()) imu.readAccel();
  if (imu.gyroAvailable())  imu.readGyro();
  if (imu.magAvailable())   imu.readMag();
  Serial.printf("  Accel[g]: X%6.2f Y%6.2f Z%6.2f\n",
                imu.calcAccel(imu.ax), imu.calcAccel(imu.ay), imu.calcAccel(imu.az));
  Serial.printf("  Gyro[dps]:X%7.1f Y%7.1f Z%7.1f\n",
                imu.calcGyro(imu.gx), imu.calcGyro(imu.gy), imu.calcGyro(imu.gz));
  Serial.printf("  Mag[gauss]:X%6.2f Y%6.2f Z%6.2f\n",
                imu.calcMag(imu.mx), imu.calcMag(imu.my), imu.calcMag(imu.mz));
}

void testGps() {
  Serial.println("[ GPS (u-blox M8N) ]");
  Serial.printf("  Chars   : %lu   Sats: %s\n",
                gps.charsProcessed(),
                gps.satellites.isValid() ? String(gps.satellites.value()).c_str() : "-");
  if (gps.location.isValid()) {
    Serial.printf("  Fix     : %.6f , %.6f\n",
                  gps.location.lat(), gps.location.lng());
    Serial.printf("  SOG     : %.2f kn   HDOP: %.1f\n",
                  gps.speed.knots(),
                  gps.hdop.isValid() ? gps.hdop.hdop() : 0.0);
  } else {
    Serial.println("  Fix     : noch keiner (Antenne/Freihimmel?)");
  }
  if (gps.charsProcessed() < 10)
    Serial.println("  !! keine NMEA-Daten – Verdrahtung/Baud pruefen");
}

// PCA9685 Ausgaenge 0..7: nacheinander je 150ms voll -> jeder Kanal pruefbar
void testPcaOutputs() {
  Serial.println("[ PCA9685 OUTPUTS 0..7 ]  (walking)");
  if (!ok_pca) { Serial.println("  PCA9685 n/a"); return; }
  for (uint8_t c = 0; c < PCA_CH_COUNT; c++) {
    pca.setPWM(c, 0, 4095);       // voll an
    smartDelay(150);
    pca.setPWM(c, 0, 0);          // aus
  }
  Serial.println("  0..7 durchgelaufen");
}

// Servo-Sweep  (immer sicher)
void testServo() {
  Serial.println("[ SERVO (GPIO18) ]  sweep 1000->2000->1500us");
  writeMicroseconds(SERVO_PIN, 1000); smartDelay(400);
  writeMicroseconds(SERVO_PIN, 2000); smartDelay(400);
  writeMicroseconds(SERVO_PIN, 1500); smartDelay(300);
}

// ESC-Ausgang: fuer den Test haengt ein Servo dran -> voller Sweep
void testEsc() {
  Serial.println("[ ESC-OUT (GPIO25) ]  sweep 1000->2000->1500us (Testservo)");
  writeMicroseconds(ESC_PIN, 1000); smartDelay(400);
  writeMicroseconds(ESC_PIN, 2000); smartDelay(400);
  writeMicroseconds(ESC_PIN, 1500); smartDelay(300);
}

// PPM einlesen (interrupt-getrieben, GPIO34)
void testPpm() {
  Serial.println("[ PPM (GPIO34) ]");
  static uint32_t lastFrames = 0;

  // Puffer atomar kopieren
  noInterrupts();
  uint32_t frames = ppmFrameCount;
  uint8_t  n      = ppmChCount;
  uint16_t local[PPM_MAX_CH];
  for (uint8_t i = 0; i < PPM_MAX_CH; i++) local[i] = ppmCh[i];
  interrupts();

  if (frames == lastFrames) {
    Serial.println("  keine neuen Frames – RX ohne Signal? (Funke noetig)");
  } else {
    Serial.printf("  Frames  : %lu   Kanaele: %u\n", (unsigned long)frames, n);
    for (uint8_t i = 0; i < n && i < PPM_MAX_CH; i++)
      Serial.printf("  CH%-2u    : %4u us\n", i + 1, local[i]);
  }
  lastFrames = frames;
}

// ===================================================================
//  LOOP
// ===================================================================
void loop() {
  static uint32_t cyc = 0;
  Serial.printf("\n############ ZYKLUS %lu  (t=%lus) ############\n",
                ++cyc, millis() / 1000);

  testPower();
  testAnalog();
  testBaro();
  testImu();
  testGps();
  testPpm();
  testPcaOutputs();
  testServo();
  testEsc();

  smartDelay(1000);   // fuettert GPS weiter
}