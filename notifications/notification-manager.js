const admin = require("firebase-admin");

class NotificationManager {
  constructor() {
    this.db = admin.firestore();
    this.realtimeDb = admin.database();
  }

  /**
   * Envoyer une notification à un utilisateur spécifique
   */
  async sendNotification(data) {
    try {
      const {
        userId,
        userType, // "customer" ou "driver"
        title,
        message,
        type = "general", // general, promo, alert, info
        priority = "normal", // normal, high
        data: extraData = {},
      } = data;

      console.log(`[Notification] 📤 Envoi à ${userType} ${userId}`);

      // Créer la notification dans Firestore
      const notificationRef = await this.db.collection("notifications").add({
        userId,
        userType,
        title,
        message,
        type,
        priority,
        data: extraData,
        seen: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
        `[Notification] ✅ Notification créée: ${notificationRef.id}`,
      );

      // Récupérer le FCM token de l'utilisateur
      const userDoc = await this.db.collection("users").doc(userId).get();
      const fcmToken = userDoc.data()?.fcmToken;

      if (fcmToken) {
        // Envoyer via Expo Push Notifications
        const pushMessage = {
          to: fcmToken,
          sound: "default",
          title: title,
          body: message,
          data: {
            notificationId: notificationRef.id,
            type,
            ...extraData,
          },
          priority: priority === "high" ? "high" : "default",
          badge: 1,
        };

        try {
          const response = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Accept-Encoding": "gzip, deflate",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(pushMessage),
          });

          const result = await response.json();

          if (result.data && result.data.status === "ok") {
            console.log(`[Notification] 🔔 Push notification envoyée`);
          } else {
            console.error(`[Notification] ❌ Erreur Expo Push:`, result);
          }
        } catch (error) {
          console.error(`[Notification] ❌ Erreur Expo Push:`, error.message);
        }
      } else {
        console.log(`[Notification] ⚠️ Pas de token pour ${userId}`);
      }

      // Mettre à jour le compteur de notifications non lues en temps réel
      await this.realtimeDb
        .ref(`users/${userId}/unreadNotifications`)
        .transaction((current) => (current || 0) + 1);

      return {
        success: true,
        notificationId: notificationRef.id,
      };
    } catch (error) {
      console.error("[Notification] ❌ Erreur:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Envoyer une notification à tous les utilisateurs d'un type
   */
  async sendBroadcast(data) {
    try {
      const {
        userType,
        title,
        message,
        type = "general",
        priority = "normal",
      } = data;

      console.log(`[Notification] 📢 Broadcast à tous les ${userType}s`);

      // Récupérer tous les utilisateurs du type spécifié
      const usersSnapshot = await this.db
        .collection("users")
        .where("userType", "==", userType)
        .get();

      console.log(
        `[Notification] 👥 ${usersSnapshot.size} utilisateurs trouvés`,
      );

      const promises = [];
      usersSnapshot.forEach((doc) => {
        promises.push(
          this.sendNotification({
            userId: doc.id,
            userType,
            title,
            message,
            type,
            priority,
          }),
        );
      });

      await Promise.all(promises);

      console.log(
        `[Notification] ✅ Broadcast envoyé à ${promises.length} utilisateurs`,
      );

      return {
        success: true,
        count: promises.length,
      };
    } catch (error) {
      console.error("[Notification] ❌ Erreur broadcast:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Récupérer les notifications d'un utilisateur
   */
  async getUserNotifications(userId, limit = 50) {
    try {
      const snapshot = await this.db
        .collection("notifications")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      const notifications = [];
      snapshot.forEach((doc) => {
        notifications.push({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate?.() || new Date(),
        });
      });

      return {
        success: true,
        notifications,
      };
    } catch (error) {
      console.error("[Notification] ❌ Erreur récupération:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsSeen(notificationId, userId) {
    try {
      await this.db.collection("notifications").doc(notificationId).update({
        seen: true,
        seenAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Décrémenter le compteur
      await this.realtimeDb
        .ref(`users/${userId}/unreadNotifications`)
        .transaction((current) => Math.max((current || 1) - 1, 0));

      return { success: true };
    } catch (error) {
      console.error("[Notification] ❌ Erreur mark as seen:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  async markAllAsSeen(userId) {
    try {
      const snapshot = await this.db
        .collection("notifications")
        .where("userId", "==", userId)
        .where("seen", "==", false)
        .get();

      const batch = this.db.batch();
      snapshot.forEach((doc) => {
        batch.update(doc.ref, {
          seen: true,
          seenAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();

      // Réinitialiser le compteur
      await this.realtimeDb.ref(`users/${userId}/unreadNotifications`).set(0);

      return {
        success: true,
        count: snapshot.size,
      };
    } catch (error) {
      console.error("[Notification] ❌ Erreur mark all as seen:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Supprimer une notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const doc = await this.db
        .collection("notifications")
        .doc(notificationId)
        .get();

      if (!doc.exists) {
        return { success: false, error: "Notification introuvable" };
      }

      const wasSeen = doc.data().seen;

      await this.db.collection("notifications").doc(notificationId).delete();

      // Si la notification n'était pas lue, décrémenter le compteur
      if (!wasSeen) {
        await this.realtimeDb
          .ref(`users/${userId}/unreadNotifications`)
          .transaction((current) => Math.max((current || 1) - 1, 0));
      }

      return { success: true };
    } catch (error) {
      console.error("[Notification] ❌ Erreur suppression:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Enregistrer le FCM token d'un utilisateur
   */
  async registerFCMToken(userId, fcmToken) {
    try {
      await this.db.collection("users").doc(userId).update({
        fcmToken,
        fcmTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`[Notification] ✅ FCM token enregistré pour ${userId}`);

      return { success: true };
    } catch (error) {
      console.error("[Notification] ❌ Erreur enregistrement FCM:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new NotificationManager();
