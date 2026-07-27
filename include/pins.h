/**********************************************************************
 *  pins.h  –  Zentrale Pin-Belegung  Modellboot
 *  MCU:  LILYGO T-A7670G R2  (ESP32-WROVER-E + A7670E LTE-Modem)
 *
 *  Alle GPIO-Zuordnungen an EINER Stelle. In test- und main-Firmware
 *  per  #include "pins.h"  einbinden, lokale Pin-Defines dort loeschen.
 *  Ablage: include/pins.h  (PlatformIO shared include dir).
 *
 *  Namen sind bewusst identisch zu den Defines im Testfile ->
 *  echter Drop-in-Ersatz fuer den dortigen Pin-Block.
 *
 *  Hinweis Input-only-Pins (ESP32): GPIO34/35/36/39 haben KEINEN
 *  internen Pull-up/-down und koennen NICHT als Output dienen.
 *********************************************************************/
#pragma once

// ===================================================================
//  UART0  –  USB / Debug  (fix, Standard-Serial)
// ===================================================================
//  GPIO1 = TX0 , GPIO3 = RX0   -> nicht anderweitig verwenden

// ===================================================================
//  I2C Bus1  (Wire)   –  zeitkritisch: nur IMU LSM9DS1
// ===================================================================
#define BUS1_SDA        19
#define BUS1_SCL        23

// ===================================================================
//  I2C Bus2  (Wire1)  –  Peripherie: BMP280, INA226, PCA9685, ADS1115
// ===================================================================
#define BUS2_SDA        32
#define BUS2_SCL        33

// ===================================================================
//  LTE-Modem  A7670E  (UART1)   –  nur main-Firmware
// ===================================================================
#define LTE_TX_PIN      26        // ESP TX -> Modem RX
#define LTE_RX_PIN      27        // ESP RX <- Modem TX
#define LTE_PWRKEY_PIN   4        // PWR_KEY (Power-On-Puls)

// ===================================================================
//  GPS  u-blox M8N  (UART2 / Serial2)
// ===================================================================
#define GPS_RX_PIN      21        // ESP RX <- GPS TX
#define GPS_TX_PIN      22        // ESP TX -> GPS RX

// ===================================================================
//  PCA9685  (LED-/Output-Treiber, Bus2)
// ===================================================================
#define PCA_OE_PIN       5        // Output-Enable, active LOW, 10k Pull-up nach 3V3

// ===================================================================
//  Aktuatoren  (SERVO PWM)
// ===================================================================
#define SERVO_PIN       18        // Ruder-Servo
#define ESC_PIN         25        // Fahrtregler / Motor

// ===================================================================
//  RC-Eingang
// ===================================================================
#define PPM_PIN         34        // PPM von Radiolink R12DSM (input-only, RX treibt Pin)


// ===================================================================
//  Uebersicht belegte GPIOs (Quick-Reference)
// -------------------------------------------------------------------
//   4  LTE PWRKEY          22  GPS TX
//   5  PCA9685 OE          23  I2C1 SCL (IMU)
//  18  Servo (Ruder)       25  ESC
//  19  I2C1 SDA (IMU)      26  LTE TX
//  21  GPS RX              27  LTE RX
//  32  I2C2 SDA            33  I2C2 SCL
//  34  PPM (in-only)       
// ===================================================================