#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "pins.h"
#include "PCA9685Driver.h"
#include "Pump.h"
#include "Lights.h"

#define TIC1_MS 10      // Update-Periode der Lichter [ms]

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

TaskHandle_t  hLightsTask = nullptr;

// ===================================================================
//  LICHT-TASK  (laeuft auf Core 0, praezise periodisch)
// ===================================================================
void lightsTask(void* param) {
  const TickType_t period = pdMS_TO_TICKS(TIC1_MS);
  TickType_t lastWake = xTaskGetTickCount();

  for (;;) {
    lights.update(TIC1_MS);                 // rechnet Pattern, schreibt PCA
    vTaskDelayUntil(&lastWake, period);     // exakt alle TIC1_MS ms
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
  lights.set_mode(3);                       // Startmodus: aus

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

  Serial.println(" Setup fertig – Licht-Task laeuft\n");
}

// ===================================================================
//  LOOP  (Core 1)  –  wechselt zum Test alle 3s den Modus durch
// ===================================================================
void loop() {
 
}