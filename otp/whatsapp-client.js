const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

class WhatsAppClient {
  constructor() {
    // Chercher Chrome dans les emplacements communs sur Windows
    const chromePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];

    let executablePath = chromePaths.find((path) => {
      try {
        const fs = require("fs");
        return fs.existsSync(path);
      } catch {
        return false;
      }
    });

    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        executablePath: executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      },
    });
    this.isReady = false;
    this.initialize();
  }

  initialize() {
    this.client.on("qr", (qr) => {
      console.log("📱 Scannez ce QR code avec WhatsApp:");
      qrcode.generate(qr, { small: true });
    });

    this.client.on("ready", () => {
      console.log("✅ WhatsApp client est prêt!");
      this.isReady = true;
    });

    this.client.on("authenticated", () => {
      console.log("🔐 Authentification réussie");
    });

    this.client.on("auth_failure", (msg) => {
      console.error("❌ Échec d'authentification:", msg);
    });

    this.client.on("disconnected", (reason) => {
      console.log("⚠️ Client déconnecté:", reason);
      this.isReady = false;
    });

    this.client.initialize();
  }

  async sendOTP(phoneNumber, otp) {
    if (!this.isReady) {
      throw new Error("WhatsApp client n'est pas prêt");
    }

    const formattedNumber = phoneNumber.replace(/[^0-9]/g, "");
    const chatId = `${formattedNumber}@c.us`;

    const message = `🔐 Votre code de vérification WODI est:\n\n*${otp}*\n\nCe code expire dans 5 minutes.\nNe partagez ce code avec personne.`;

    try {
      // Vérifier si le numéro existe sur WhatsApp
      const isRegistered = await this.client.isRegisteredUser(chatId);

      if (!isRegistered) {
        console.error(`❌ Le numéro ${phoneNumber} n'est pas sur WhatsApp`);
        throw new Error(
          `Le numéro ${phoneNumber} n'est pas enregistré sur WhatsApp`,
        );
      }

      await this.client.sendMessage(chatId, message);
      console.log(`✅ Message envoyé à ${phoneNumber}`);
      return { success: true };
    } catch (error) {
      console.error("Erreur envoi WhatsApp:", error);
      throw error;
    }
  }
}

module.exports = WhatsAppClient;
