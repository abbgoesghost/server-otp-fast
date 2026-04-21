const express = require("express");
const router = express.Router();
const notificationManager = require("../notifications/notification-manager");

/**
 * Envoyer une notification à un utilisateur spécifique
 * POST /api/notifications/send
 */
router.post("/send", async (req, res) => {
  try {
    const { userId, userType, title, message, type, priority, data } = req.body;

    if (!userId || !userType || !title || !message) {
      return res.status(400).json({
        success: false,
        error: "userId, userType, title et message sont requis",
      });
    }

    const result = await notificationManager.sendNotification({
      userId,
      userType,
      title,
      message,
      type,
      priority,
      data,
    });

    res.json(result);
  } catch (error) {
    console.error("Erreur envoi notification:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Envoyer une notification à tous les utilisateurs d'un type
 * POST /api/notifications/broadcast
 */
router.post("/broadcast", async (req, res) => {
  try {
    const { userType, title, message, type, priority } = req.body;

    if (!userType || !title || !message) {
      return res.status(400).json({
        success: false,
        error: "userType, title et message sont requis",
      });
    }

    const result = await notificationManager.sendBroadcast({
      userType,
      title,
      message,
      type,
      priority,
    });

    res.json(result);
  } catch (error) {
    console.error("Erreur broadcast notification:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Récupérer les notifications d'un utilisateur
 * GET /api/notifications/:userId
 */
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const result = await notificationManager.getUserNotifications(
      userId,
      limit,
    );

    res.json(result);
  } catch (error) {
    console.error("Erreur récupération notifications:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Marquer une notification comme lue
 * PUT /api/notifications/:notificationId/seen
 */
router.put("/:notificationId/seen", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId est requis",
      });
    }

    const result = await notificationManager.markAsSeen(notificationId, userId);

    res.json(result);
  } catch (error) {
    console.error("Erreur mark as seen:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Marquer toutes les notifications comme lues
 * PUT /api/notifications/:userId/seen-all
 */
router.put("/:userId/seen-all", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await notificationManager.markAllAsSeen(userId);

    res.json(result);
  } catch (error) {
    console.error("Erreur mark all as seen:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Supprimer une notification
 * DELETE /api/notifications/:notificationId
 */
router.delete("/:notificationId", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId est requis",
      });
    }

    const result = await notificationManager.deleteNotification(
      notificationId,
      userId,
    );

    res.json(result);
  } catch (error) {
    console.error("Erreur suppression notification:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Enregistrer le FCM token d'un utilisateur
 * POST /api/notifications/register-token
 */
router.post("/register-token", async (req, res) => {
  try {
    const { userId, fcmToken } = req.body;

    if (!userId || !fcmToken) {
      return res.status(400).json({
        success: false,
        error: "userId et fcmToken sont requis",
      });
    }

    const result = await notificationManager.registerFCMToken(userId, fcmToken);

    res.json(result);
  } catch (error) {
    console.error("Erreur enregistrement FCM token:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
