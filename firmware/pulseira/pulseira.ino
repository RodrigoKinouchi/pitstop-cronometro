// Pulseira de cronometragem de pit stop — ESP32-C3 SuperMini + MPU6050
//
// Ligações:
//   MPU6050  VCC -> 3V3   GND -> GND   SDA -> GPIO5   SCL -> GPIO6
//   Buzzer ativo 3–5 V: (+) no 5V/bateria, (−) no coletor de um NPN (BC547/2N2222);
//                       base do NPN no GPIO3 via 1 kΩ; emissor no GND
//   Botão    entre GPIO4 e GND (usa pull-up interno)
//   LED      GPIO7 -> resistor 330 Ω -> LED -> GND
//   Bateria  divisor 100 kΩ / 100 kΩ entre BAT+ e GND, ponto central no GPIO0
//
// Placa na Arduino IDE: "ESP32C3 Dev Module", com "USB CDC On Boot: Enabled".

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <freertos/queue.h>
#include <math.h>

constexpr int PIN_SDA = 5, PIN_SCL = 6, PIN_BUZZER = 3, PIN_BOTAO = 4, PIN_LED = 7, PIN_BATERIA = 0;

#define NOME_BLE     "PitStop-Pulseira"
#define SERVICE_UUID "6e1f0001-7a3b-4c8e-9d2a-5c7b1e0f9a01"
#define CMD_UUID     "6e1f0002-7a3b-4c8e-9d2a-5c7b1e0f9a01"
#define EVT_UUID     "6e1f0003-7a3b-4c8e-9d2a-5c7b1e0f9a01"

constexpr uint8_t MPU_ADDR = 0x68;
constexpr float LSB_POR_G = 4096.0f;          // faixa ±8 g
constexpr uint32_t AMOSTRA_US = 2000;         // 500 Hz
constexpr uint32_t REENVIO_MS = 1000;
constexpr uint32_t STATUS_MS = 2000;
constexpr uint32_t BOTAO_LONGO_MS = 2000;
constexpr int MAX_PENDENTES = 40;

// ---------- Configuração da tentativa (vem do tablet; a última fica salva para o botão) ----------
struct Config {
  uint32_t atrasoMin = 1500, atrasoMax = 3500;  // ms entre PRONTO e o bipe
  uint32_t minimo = 1500;                      // ms: braço levantado antes disso é ignorado
  uint32_t maximo = 20000;                     // ms: desiste da tentativa
  uint32_t confirma = 100;                     // ms que o braço precisa ficar para cima
  float angulo = 35;                           // graus de tolerância em torno da posição calibrada
} cfg;

Preferences prefs;
float upX = 0, upY = 0, upZ = 1;  // direção "braço para cima" medida na calibração
bool calibrado = false, imuOk = false;
uint32_t proximoId = 1;

// ---------- Estado ----------
enum Estado { PARADO, ARMADO, CORRENDO };
Estado estado = PARADO;
uint8_t origem = 0;        // 0 = tablet, 1 = botão da pulseira
uint32_t idAtual = 0;
uint32_t tBipeUs = 0;      // quando o bipe de largada vai tocar
uint32_t t0Us = 0;         // instante do bipe
uint32_t tCimaUs = 0;      // início do braço para cima
bool viuBaixo = false;
bool bracoCima = false, ultimoCimaEnviado = false;

struct Resultado { uint32_t id, ms; uint8_t origem; };
Resultado pendentes[MAX_PENDENTES];
int nPendentes = 0;

BLECharacteristic *evt = nullptr;
volatile bool conectado = false;
QueueHandle_t filaCmd;

// ---------- Buzzer não bloqueante ----------
struct Toque { uint16_t ligadoMs, desligadoMs; };
Toque padrao[6];
int nToques = 0, toqueAtual = 0;
bool buzzerLigado = false;
uint32_t buzzerAteMs = 0;

void tocar(std::initializer_list<Toque> seq) {
  nToques = 0;
  for (auto &t : seq) if (nToques < 6) padrao[nToques++] = t;
  toqueAtual = 0;
  buzzerLigado = true;
  digitalWrite(PIN_BUZZER, HIGH);
  buzzerAteMs = millis() + padrao[0].ligadoMs;
}
void atualizarBuzzer() {
  if (toqueAtual >= nToques || (int32_t)(millis() - buzzerAteMs) < 0) return;
  if (buzzerLigado) {
    buzzerLigado = false;
    digitalWrite(PIN_BUZZER, LOW);
    buzzerAteMs = millis() + padrao[toqueAtual].desligadoMs;
  } else if (++toqueAtual < nToques) {
    buzzerLigado = true;
    digitalWrite(PIN_BUZZER, HIGH);
    buzzerAteMs = millis() + padrao[toqueAtual].ligadoMs;
  }
}

// ---------- Comunicação ----------
void enviar(const String &msg) {
  if (!conectado || !evt) return;
  evt->setValue((uint8_t *)msg.c_str(), msg.length());
  evt->notify();
}

class ServidorCb : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { conectado = true; }
  void onDisconnect(BLEServer *s) override {
    conectado = false;
    s->getAdvertising()->start();
  }
};
class ComandoCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    char buf[64] = {0};
    String v = String(c->getValue().c_str());
    v.toCharArray(buf, sizeof(buf));
    xQueueSend(filaCmd, buf, 0);
  }
};

// ---------- MPU6050 ----------
void mpuEscrever(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}
bool mpuIniciar() {
  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) return false;
  mpuEscrever(0x6B, 0x01);  // acorda, clock do giroscópio X
  mpuEscrever(0x1A, 0x03);  // filtro passa-baixa 44 Hz
  mpuEscrever(0x19, 0x01);  // 500 amostras/s
  mpuEscrever(0x1C, 0x10);  // ±8 g
  return true;
}
bool mpuLer(float &ax, float &ay, float &az) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)6) != 6) return false;
  int16_t x = (Wire.read() << 8) | Wire.read();
  int16_t y = (Wire.read() << 8) | Wire.read();
  int16_t z = (Wire.read() << 8) | Wire.read();
  ax = x / LSB_POR_G; ay = y / LSB_POR_G; az = z / LSB_POR_G;
  return true;
}

// Braço para cima = aceleração medida aponta para a mesma direção gravada na calibração.
// Em movimento brusco o módulo foge de ~1 g e a leitura é descartada.
bool estaParaCima(float ax, float ay, float az) {
  float n = sqrtf(ax * ax + ay * ay + az * az);
  if (n < 0.5f || n > 1.8f) return false;
  float cosAng = (ax * upX + ay * upY + az * upZ) / n;
  return cosAng >= cosf(cfg.angulo * DEG_TO_RAD);
}

void calibrar() {
  float sx = 0, sy = 0, sz = 0, ax, ay, az;
  int n = 0;
  for (int i = 0; i < 100; i++) {
    if (mpuLer(ax, ay, az)) { sx += ax; sy += ay; sz += az; n++; }
    delay(3);
  }
  float norma = sqrtf(sx * sx + sy * sy + sz * sz);
  if (n < 50 || norma < 0.1f) { enviar("L,0"); return; }
  upX = sx / norma; upY = sy / norma; upZ = sz / norma;
  calibrado = true;
  prefs.putFloat("ux", upX); prefs.putFloat("uy", upY); prefs.putFloat("uz", upZ);
  prefs.putBool("cal", true);
  tocar({{60, 60}, {60, 0}});
  enviar("L,1");
}

// ---------- Tentativa ----------
void armar(uint8_t org) {
  if (!imuOk || !calibrado) {
    enviar(imuOk ? "X,N" : "X,I");
    tocar({{400, 0}});
    return;
  }
  origem = org;
  idAtual = proximoId++;
  prefs.putUInt("id", proximoId);
  uint32_t faixa = cfg.atrasoMax > cfg.atrasoMin ? cfg.atrasoMax - cfg.atrasoMin : 0;
  tBipeUs = micros() + (cfg.atrasoMin + (faixa ? esp_random() % faixa : 0)) * 1000UL;
  estado = ARMADO;
  tocar({{40, 80}, {40, 0}});
  enviar("A," + String(idAtual) + "," + String(origem));
}

void cancelar(const char *motivo) {
  estado = PARADO;
  enviar(String("X,") + motivo);
}

void guardarResultado(uint32_t ms) {
  if (nPendentes == MAX_PENDENTES) {
    memmove(pendentes, pendentes + 1, sizeof(Resultado) * (MAX_PENDENTES - 1));
    nPendentes--;
  }
  pendentes[nPendentes++] = {idAtual, ms, origem};
}

void enviarPendentes() {
  for (int i = 0; i < nPendentes; i++)
    enviar("R," + String(pendentes[i].id) + "," + String(pendentes[i].ms) + "," + String(pendentes[i].origem));
}

void confirmarRecebido(uint32_t id) {
  for (int i = 0; i < nPendentes; i++) {
    if (pendentes[i].id != id) continue;
    memmove(pendentes + i, pendentes + i + 1, sizeof(Resultado) * (nPendentes - i - 1));
    nPendentes--;
    return;
  }
}

void processarAmostra(uint32_t agoraUs) {
  float ax, ay, az;
  if (!mpuLer(ax, ay, az)) return;
  bracoCima = calibrado && estaParaCima(ax, ay, az);
  if (estado != CORRENDO) return;

  uint32_t decorrido = agoraUs - t0Us;
  if (!bracoCima) {
    viuBaixo = true;
    tCimaUs = 0;
  } else if (viuBaixo) {
    if (tCimaUs == 0) tCimaUs = agoraUs;
    if (agoraUs - tCimaUs >= cfg.confirma * 1000UL) {
      uint32_t ms = (tCimaUs - t0Us) / 1000UL;
      if (ms >= cfg.minimo) {
        estado = PARADO;
        guardarResultado(ms);
        tocar({{80, 0}});
        enviarPendentes();
        return;
      }
      viuBaixo = false;  // levantou cedo demais: espera abaixar e levantar de novo
      tCimaUs = 0;
    }
  }
  if (decorrido > cfg.maximo * 1000UL) {
    tocar({{300, 0}});
    cancelar("T");
  }
}

// ---------- Comandos do tablet ----------
//   P,atrasoMin,atrasoMax,minimo,maximo,confirma,angulo   arma a tentativa
//   C        cancela          K,id   confirma recebimento de um resultado
//   L        calibra "braço para cima"                     B   bipe de teste
void tratarComando(const char *c) {
  switch (c[0]) {
    case 'P': {
      unsigned long a, b, mi, ma, co; float an;
      if (sscanf(c, "P,%lu,%lu,%lu,%lu,%lu,%f", &a, &b, &mi, &ma, &co, &an) == 6) {
        cfg.atrasoMin = a; cfg.atrasoMax = b; cfg.minimo = mi; cfg.maximo = ma; cfg.confirma = co; cfg.angulo = an;
        prefs.putBytes("cfg", &cfg, sizeof(cfg));
      }
      if (estado == PARADO) armar(0);
      break;
    }
    case 'C': if (estado != PARADO) cancelar("C"); break;
    case 'K': confirmarRecebido(strtoul(c + 2, nullptr, 10)); break;
    case 'L': if (estado == PARADO) calibrar(); break;
    case 'B': tocar({{150, 0}}); break;
  }
}

// ---------- Botão e LED ----------
void atualizarBotao() {
  static bool antes = false;
  static uint32_t desde = 0;
  static bool longoFeito = false;
  bool agora = digitalRead(PIN_BOTAO) == LOW;
  uint32_t ms = millis();
  if (agora && !antes) { desde = ms; longoFeito = false; }
  if (agora && !longoFeito && ms - desde >= BOTAO_LONGO_MS && estado == PARADO) {
    longoFeito = true;
    calibrar();
  }
  if (!agora && antes && !longoFeito && ms - desde > 30) {
    if (estado == PARADO) armar(1);
    else if (estado == ARMADO) cancelar("C");
  }
  antes = agora;
}

void atualizarLed() {
  uint32_t ms = millis();
  bool aceso;
  if (estado == ARMADO) aceso = (ms / 100) % 2;
  else if (estado == CORRENDO) aceso = false;
  else if (!calibrado || !imuOk) aceso = (ms / 150) % 6 < 3 && (ms / 150) % 2 == 0;
  else if (conectado) aceso = true;
  else aceso = (ms / 500) % 2;
  digitalWrite(PIN_LED, aceso);
}

uint32_t bateriaMv() { return analogReadMilliVolts(PIN_BATERIA) * 2; }

// ---------- Inicialização e laço ----------
void setup() {
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BOTAO, INPUT_PULLUP);
  Serial.begin(115200);

  prefs.begin("pulseira", false);
  calibrado = prefs.getBool("cal", false);
  upX = prefs.getFloat("ux", 0); upY = prefs.getFloat("uy", 0); upZ = prefs.getFloat("uz", 1);
  proximoId = prefs.getUInt("id", 1);
  if (prefs.getBytesLength("cfg") == sizeof(cfg)) prefs.getBytes("cfg", &cfg, sizeof(cfg));

  imuOk = mpuIniciar();
  filaCmd = xQueueCreate(8, 64);

  BLEDevice::init(NOME_BLE);
  BLEServer *srv = BLEDevice::createServer();
  srv->setCallbacks(new ServidorCb());
  BLEService *svc = srv->createService(SERVICE_UUID);
  BLECharacteristic *cmd = svc->createCharacteristic(CMD_UUID, BLECharacteristic::PROPERTY_WRITE);
  cmd->setCallbacks(new ComandoCb());
  evt = svc->createCharacteristic(EVT_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  evt->addDescriptor(new BLE2902());
  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();

  tocar({{60, 60}, {60, 60}, {60, 0}});
  Serial.printf("Pulseira pronta. IMU %s, calibrada %s\n", imuOk ? "ok" : "FALHOU", calibrado ? "sim" : "nao");
}

void loop() {
  static uint32_t ultimaAmostra = 0, ultimoReenvio = 0, ultimoStatus = 0;
  uint32_t agoraUs = micros();

  char buf[64];
  while (xQueueReceive(filaCmd, buf, 0) == pdTRUE) tratarComando(buf);

  if (estado == ARMADO && (int32_t)(agoraUs - tBipeUs) >= 0) {
    tocar({{400, 0}});
    t0Us = micros();
    estado = CORRENDO;
    viuBaixo = false;
    tCimaUs = 0;
    enviar("B," + String(idAtual));
  }

  if (imuOk && agoraUs - ultimaAmostra >= AMOSTRA_US) {
    ultimaAmostra = agoraUs;
    processarAmostra(agoraUs);
  }

  if (bracoCima != ultimoCimaEnviado && estado != CORRENDO) {
    ultimoCimaEnviado = bracoCima;
    enviar(String("U,") + (bracoCima ? 1 : 0));
  }

  uint32_t ms = millis();
  if (nPendentes && conectado && ms - ultimoReenvio >= REENVIO_MS) {
    ultimoReenvio = ms;
    enviarPendentes();
  }
  if (conectado && ms - ultimoStatus >= STATUS_MS) {
    ultimoStatus = ms;
    enviar("H," + String(estado) + "," + String(bateriaMv()) + "," + String(calibrado) + "," + String(imuOk) + "," + String(nPendentes));
  }

  atualizarBotao();
  atualizarBuzzer();
  atualizarLed();
}
