#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "pins.h"
#include "PCA9685Driver.h"
#include "Pump.h"
#include "Lights.h"
#include "RcReceiver.h"
#include "Actuators.h"
#include "LSM9DS1Sensor.h"
#include "INA226.h"
#include <Adafruit_BMP280.h>
#include "ADS1115.h"
#include "GpsModule.h"

#define TIC1_MS 10      // Update-Periode der Lichter [ms]
#define TIC2_MS 10     // Update-Periode der Regelung [ms]
// ===================================================================
//  KANAL-BELEGUNG PCA9685  (0..7 = Output-Treiber)
// ===================================================================
#define PCA_ADDR   0x40      // steht (noch) nicht in pins.h

// ===================================================================
//  OBJEKTE  –  EIN gemeinsames PCA-Objekt, per Referenz geteilt
// ===================================================================
PCA9685Driver pca(Wire1, PCA_ADDR, PCA_OE_PIN, 1000);
Pump          pump(pca);
Lights        lights(pca);
RcReceiver    rc(SBUS_PIN);   // GPIO34, UART1 per Default
Actuators actuators(ESC_PIN, SERVO_PIN);   // GPIO25, GPIO18 aus pins.h
LSM9DS1Sensor imu;   // Default: Wire (Bus1)
INA226 INA(0x45, &Wire1);    // Adresse, dann Zeiger auf den Bus
Adafruit_BMP280 bmp(&Wire1);   // Zeiger auf den Bus
ADS1115 ads(Wire1, 0x48);     // Zeiger auf den Bus, Adresse
GpsModule gps(Serial2);

TaskHandle_t  hLightsTask = nullptr;


// ===================================================================
//  LICHT-TASK  (laeuft auf Core 0, praezise periodisch)
// ===================================================================
void lightsTask(void* param) {
  const TickType_t period = pdMS_TO_TICKS(TIC1_MS);
  TickType_t lastWake = xTaskGetTickCount();

  for (;;) {
    lights.update(TIC1_MS);                 // rechnet Pattern, schreibt PCA
    ads.update();
    vTaskDelayUntil(&lastWake, period);     // exakt alle TIC1_MS ms
  }
}


// ===================================================================
//  regelung-TASK  (laeuft auf Core 0, praezise periodisch)
// ===================================================================
void controllerTask(void* param) {
  const TickType_t period = pdMS_TO_TICKS(TIC2_MS);
  TickType_t lastWake = xTaskGetTickCount();

  for (;;) {
   
    rc.update();
    gps.update();
    imu.update();
    actuators.setThrottle(rc.getChannel(ThrottleChannel));
    actuators.setRudder(rc.getChannel(RudderChannel));
    
    

    vTaskDelayUntil(&lastWake, period);     // exakt alle TIC2_MS ms
  }
}


// ===================================================================
//  SETUP
// ===================================================================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n\n======================================");
  Serial.println(" MFOS FW. 1.0.0");
  Serial.println("======================================");

  // Bus2 (Wire1) einmal initialisieren -> PCA + spaeter BMP/INA
  if (pca.begin(BUS2_SDA, BUS2_SCL)) {
    Serial.println("  PCA9685  : OK");
  } else {
    Serial.println("  PCA9685  : FAIL (Verdrahtung/Adresse pruefen)");
  }

  lights.allOff();
  pump.off();
  lights.set_mode(0);                       // Startmodus: aus
  gps.begin(GPS_RX_PIN, GPS_TX_PIN);   // GPIO21 RX, GPIO22 TX (aus pins.h)
  rc.begin();
  actuators.begin();


  if (!bmp.begin(0x76)) {
      Serial.println("  BMP280   : FAIL");
  } else {
      Serial.println("  BMP280   : OK");
  }


  if (!ads.begin()) {
      Serial.println("  ADS1115  : FAIL");
  } else {
      Serial.println("  ADS1115  : OK");
  }


  if (!INA.begin()) {
    Serial.println("  INA226   : FAIL");
  } else {
    Serial.println("  INA226   : OK");
    INA.setMaxCurrentShunt(10.0, 0.003);   // maxStrom [A], Shunt [Ohm]
  }


  if (!imu.begin(BUS1_SDA, BUS1_SCL)) {   // GPIO23, GPIO19
    Serial.println("  LSM9DS1  : FAIL");
  }else {
    Serial.println("  LSM9DS1  : OK");
  }
  
  imu.loadMagOffset(161, 863, -2953);  // fixe Hard-Iron-Offsets

  //imu.calibrateMag(120);

  //calibrateMag(120);   // max. 60s, danach Abbruch
  // Licht-Task auf Core 0 starten (dort liegt die Bus2-Peripherie)
  xTaskCreatePinnedToCore(
    lightsTask,      // Task-Funktion
    "lights",        // Name
    4096,            // Stack [Bytes]
    nullptr,         // Parameter
    1,               // Prioritaet (1 = niedrig, ueber Idle)
    &hLightsTask,    // Handle
    0                // Core 0
  );
    // Licht-Task auf Core 0 starten (dort liegt die Bus2-Peripherie)
  xTaskCreatePinnedToCore(
    controllerTask,      // Task-Funktion
    "controller",        // Name
    4096,            // Stack [Bytes]
    nullptr,         // Parameter
    10,               // Prioritaet (1 = niedrig, ueber Idle)
    &hLightsTask,    // Handle
    0                // Core 0
  );

  Serial.println(" Setup fertig – Licht-Task laeuft\n");
}

// ===================================================================
//  LOOP  (Core 1)  –  wechselt zum Test alle 3s den Modus durch
// ===================================================================


void loop() {
  
  
    Serial.printf("  Throttle: %.1f %%\n", rc.getChannel(ThrottleChannel));
    Serial.printf("  Rudder:   %.1f %%\n", rc.getChannel(RudderChannel));
    Serial.printf("  Signal: %d %%\n", rc.hasSignal());
    Serial.printf(" iMU: %.1f °, %.1f °, %.1f °, %.1f °\n", imu.getRoll(), imu.getPitch(), imu.getHeading(), imu.getHeadingFlat());
    Serial.printf("  Mag: %.3f, %.3f, %.3f\n", imu.getMagX(), imu.getMagY(), imu.getMagZ());
    Serial.printf("  Accel: %.3f, %.3f, %.3f\n", imu.getAccelX(), imu.getAccelY(), imu.getAccelZ());
    Serial.printf("  Gyro:  %.3f, %.3f, %.3f\n", imu.getGyroX(), imu.getGyroY(), imu.getGyroZ());
    Serial.printf("  INA: %.3f V, %.3f mA, %.3f mW\n", INA.getBusVoltage(), INA.getCurrent()*1000, INA.getPower()*1000);
    Serial.printf("  BMP: %.3f °C, %.3f hPa\n", bmp.readTemperature(), bmp.readPressure()/100.0f);
    Serial.printf("  ADS: %.3f °C, %.3f V \n", ads.getTemperature(), ads.getWaterVoltage());

    if (gps.hasFix()) {
        Serial.printf("  GPS: %.6f, %.6f  %.1f km/h  %.0f°  Sats %d\n",
        gps.getLat(), gps.getLon(), gps.getSpeedKmh(), gps.getCourse(), gps.getSats());
    } else {
        Serial.printf("  GPS: kein Fix (Sats %d)\n", gps.getSats());
    }
    
    Serial.println("--------------------------------------------------");

    if(rc.getChannel(8) > 0.0f) {
      pump.off();
    } else {
      pump.on();
    }

    if(rc.getChannel(9) > 0.0f) {
      lights.set_mode(0);
    } else {
      lights.set_mode(3);
    }

  delay(1000);
}
 
