class OTPManager {
  constructor() {
    this.otpStore = new Map();
    this.OTP_EXPIRY = 5 * 60 * 1000; // 5 minutes
  }

  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  storeOTP(phoneNumber, otp) {
    this.otpStore.set(phoneNumber, {
      otp,
      timestamp: Date.now(),
    });
  }

  verifyOTP(phoneNumber, otp) {
    const stored = this.otpStore.get(phoneNumber);

    if (!stored) {
      return { success: false, message: "OTP non trouvé" };
    }

    if (Date.now() - stored.timestamp > this.OTP_EXPIRY) {
      this.otpStore.delete(phoneNumber);
      return { success: false, message: "OTP expiré" };
    }

    if (stored.otp === otp) {
      this.otpStore.delete(phoneNumber);
      return { success: true, message: "Vérification réussie" };
    }

    return { success: false, message: "OTP incorrect" };
  }

  cleanExpiredOTPs() {
    const now = Date.now();
    for (const [phone, data] of this.otpStore.entries()) {
      if (now - data.timestamp > this.OTP_EXPIRY) {
        this.otpStore.delete(phone);
      }
    }
  }
}

module.exports = OTPManager;
