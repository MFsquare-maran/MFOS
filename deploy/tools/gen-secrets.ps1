# Erzeugt starke, zufaellige Passwoerter fuer deploy/.env (Windows PowerShell).
# Aufruf:  powershell -ExecutionPolicy Bypass -File deploy\tools\gen-secrets.ps1
# Die Ausgabe nur in die .env oder die Portainer-Variablen kopieren, sonst nirgends hin.

function New-Secret([int]$Length = 32) {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.ToCharArray()
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object 'System.Byte[]' 1
    $out = New-Object System.Text.StringBuilder
    while ($out.Length -lt $Length) {
        $rng.GetBytes($bytes)
        # Werte oberhalb des vollen Vielfachen verwerfen, damit alle Zeichen gleich wahrscheinlich sind
        if ($bytes[0] -lt 248) { [void]$out.Append($chars[$bytes[0] % $chars.Length]) }
    }
    $rng.Dispose()
    return $out.ToString()
}

Write-Output '# Zufaellige Passwoerter (je 32 Zeichen, nur Buchstaben und Ziffern):'
Write-Output ('DASHBOARD_PASSWORD=' + (New-Secret 32))
Write-Output ('MQTT_BOAT_PASSWORD=' + (New-Secret 32))
Write-Output ('MQTT_BACKEND_PASSWORD=' + (New-Secret 32))
Write-Output ''
Write-Output '# Das Boot-Passwort kommt zusaetzlich in die Firmware, die anderen nirgends hin.'
