const admin = require("../config/firebase-admin");
const crypto = require("crypto");

const ENCRYPTION_KEY =
  process.env.WALLET_ENCRYPTION_KEY || "wodi-wallet-secret-key-2024-secure";
const ALGORITHM = "aes-256-cbc";

class WalletManager {
  constructor() {
    this.db = admin.firestore();
  }

  // Générer une clé de cryptage à partir de la clé secrète
  getEncryptionKey() {
    return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
  }

  // Crypter le montant du wallet
  encryptAmount(amount) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      ALGORITHM,
      this.getEncryptionKey(),
      iv,
    );

    let encrypted = cipher.update(amount.toString(), "utf8", "hex");
    encrypted += cipher.final("hex");

    return {
      encrypted: encrypted,
      iv: iv.toString("hex"),
    };
  }

  // Décrypter le montant du wallet
  decryptAmount(encryptedData, ivHex) {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      this.getEncryptionKey(),
      Buffer.from(ivHex, "hex"),
    );

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return parseFloat(decrypted);
  }

  // Générer un token de transaction unique
  generateTransactionToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  // Créer un wallet pour un utilisateur
  async createWallet(userId) {
    try {
      const walletRef = this.db.collection("wallets").doc(userId);
      const walletDoc = await walletRef.get();

      if (walletDoc.exists) {
        return { success: false, message: "Wallet existe déjà" };
      }

      const initialAmount = 0;
      const { encrypted, iv } = this.encryptAmount(initialAmount);

      await walletRef.set({
        userId,
        balance: encrypted,
        iv: iv,
        currency: "XOF",
        termsAccepted: false,
        termsAcceptedAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        message: "Wallet créé",
        balance: initialAmount,
      };
    } catch (error) {
      console.error("Erreur création wallet:", error);
      return { success: false, message: error.message };
    }
  }

  // Accepter les conditions du wallet
  async acceptTerms(userId) {
    try {
      const walletRef = this.db.collection("wallets").doc(userId);
      const walletDoc = await walletRef.get();

      if (!walletDoc.exists) {
        // Créer le wallet si il n'existe pas
        await this.createWallet(userId);
      }

      await walletRef.update({
        termsAccepted: true,
        termsAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, message: "Conditions acceptées" };
    } catch (error) {
      console.error("Erreur acceptation conditions:", error);
      return { success: false, message: error.message };
    }
  }

  // Récupérer le solde du wallet
  async getBalance(userId) {
    try {
      const walletRef = this.db.collection("wallets").doc(userId);
      const walletDoc = await walletRef.get();

      if (!walletDoc.exists) {
        return { success: false, message: "Wallet non trouvé", balance: 0 };
      }

      const walletData = walletDoc.data();
      const balance = this.decryptAmount(walletData.balance, walletData.iv);

      return {
        success: true,
        balance: balance,
        currency: walletData.currency,
        termsAccepted: walletData.termsAccepted,
      };
    } catch (error) {
      console.error("Erreur récupération balance:", error);
      return { success: false, message: error.message, balance: 0 };
    }
  }

  // Ajouter des fonds (transaction sécurisée)
  async addFunds(userId, amount, transactionType = "deposit", metadata = {}) {
    try {
      console.log(
        `💰 addFunds appelé - userId: ${userId}, amount: ${amount}, type: ${transactionType}`,
      );

      const walletRef = this.db.collection("wallets").doc(userId);
      const walletDoc = await walletRef.get();

      if (!walletDoc.exists) {
        console.error(`❌ Wallet non trouvé pour userId: ${userId}`);
        return { success: false, message: "Wallet non trouvé" };
      }

      const walletData = walletDoc.data();
      console.log(`📊 Wallet data récupéré:`, {
        termsAccepted: walletData.termsAccepted,
      });

      if (!walletData.termsAccepted) {
        console.error(`❌ Conditions non acceptées pour userId: ${userId}`);
        return {
          success: false,
          message: "Conditions du wallet non acceptées",
        };
      }

      const currentBalance = this.decryptAmount(
        walletData.balance,
        walletData.iv,
      );
      console.log(`💵 Solde actuel: ${currentBalance} XOF`);

      const newBalance = currentBalance + amount;
      console.log(`💵 Nouveau solde: ${newBalance} XOF`);

      const { encrypted, iv } = this.encryptAmount(newBalance);

      // Créer la transaction
      const transactionToken = this.generateTransactionToken();
      const transactionRef = this.db.collection("wallet_transactions").doc();

      console.log(`📝 Création transaction avec token: ${transactionToken}`);

      await this.db.runTransaction(async (transaction) => {
        transaction.update(walletRef, {
          balance: encrypted,
          iv: iv,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.set(transactionRef, {
          userId,
          transactionToken,
          type: transactionType,
          amount: amount,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          currency: "XOF",
          status: "completed",
          metadata: metadata,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Mettre à jour Firebase Realtime Database pour les mises à jour en temps réel
      try {
        console.log(`📡 Mise à jour Realtime Database pour userId: ${userId}`);
        await admin.database().ref(`wallets/${userId}`).update({
          balance: newBalance,
          updatedAt: Date.now(),
        });
        console.log(`✅ Realtime Database mis à jour`);
      } catch (realtimeError) {
        console.error(
          `⚠️ Erreur mise à jour Realtime Database:`,
          realtimeError,
        );
        // Ne pas échouer la transaction si Realtime DB échoue
      }

      console.log(`✅ Transaction complétée avec succès!`);

      return {
        success: true,
        message: "Fonds ajoutés",
        balance: newBalance,
        transactionToken,
      };
    } catch (error) {
      console.error("❌ Erreur ajout fonds:", error);
      return { success: false, message: error.message };
    }
  }

  // Retirer des fonds (transaction sécurisée)
  async deductFunds(
    userId,
    amount,
    transactionType = "payment",
    metadata = {},
  ) {
    try {
      const walletRef = this.db.collection("wallets").doc(userId);
      const walletDoc = await walletRef.get();

      if (!walletDoc.exists) {
        return { success: false, message: "Wallet non trouvé" };
      }

      const walletData = walletDoc.data();

      if (!walletData.termsAccepted) {
        return {
          success: false,
          message: "Conditions du wallet non acceptées",
        };
      }

      const currentBalance = this.decryptAmount(
        walletData.balance,
        walletData.iv,
      );

      if (currentBalance < amount) {
        return { success: false, message: "Solde insuffisant" };
      }

      const newBalance = currentBalance - amount;
      const { encrypted, iv } = this.encryptAmount(newBalance);

      const transactionToken = this.generateTransactionToken();
      const transactionRef = this.db.collection("wallet_transactions").doc();

      await this.db.runTransaction(async (transaction) => {
        transaction.update(walletRef, {
          balance: encrypted,
          iv: iv,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.set(transactionRef, {
          userId,
          transactionToken,
          type: transactionType,
          amount: -amount,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          currency: "XOF",
          status: "completed",
          metadata: metadata,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Mettre à jour Firebase Realtime Database pour les mises à jour en temps réel
      try {
        console.log(`📡 Mise à jour Realtime Database pour userId: ${userId}`);
        await admin.database().ref(`wallets/${userId}`).update({
          balance: newBalance,
          updatedAt: Date.now(),
        });
        console.log(`✅ Realtime Database mis à jour`);
      } catch (realtimeError) {
        console.error(
          `⚠️ Erreur mise à jour Realtime Database:`,
          realtimeError,
        );
        // Ne pas échouer la transaction si Realtime DB échoue
      }

      return {
        success: true,
        message: "Fonds déduits",
        balance: newBalance,
        transactionToken,
      };
    } catch (error) {
      console.error("Erreur déduction fonds:", error);
      return { success: false, message: error.message };
    }
  }

  // Récupérer l'historique des transactions
  async getTransactions(userId, limit = 50) {
    try {
      const transactionsRef = this.db
        .collection("wallet_transactions")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(limit);

      const snapshot = await transactionsRef.get();

      const transactions = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { success: true, transactions };
    } catch (error) {
      console.error("Erreur récupération transactions:", error);
      return { success: false, message: error.message, transactions: [] };
    }
  }
}

module.exports = WalletManager;
