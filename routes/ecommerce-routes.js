const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();

// Récupérer un produit par ID
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    const productDoc = await admin
      .firestore()
      .collection("ecommerce_products")
      .doc(productId)
      .get();

    if (!productDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Produit introuvable",
      });
    }

    res.json({
      success: true,
      product: {
        id: productDoc.id,
        ...productDoc.data(),
      },
    });
  } catch (error) {
    console.error("Erreur récupération produit:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Créer une commande
router.post("/order", async (req, res) => {
  try {
    const {
      userId,
      productId,
      paymentMethod,
      promoCode,
      promoDiscount,
      finalPrice,
    } = req.body;

    if (!userId || !productId || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Récupérer le produit
    const productDoc = await admin
      .firestore()
      .collection("ecommerce_products")
      .doc(productId)
      .get();

    if (!productDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Produit introuvable",
      });
    }

    const product = productDoc.data();

    if (!product.inStock) {
      return res.status(400).json({
        success: false,
        message: "Produit en rupture de stock",
      });
    }

    // Récupérer l'utilisateur
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();
    const userData = userDoc.data();

    // Calculer le prix final
    const orderPrice = finalPrice || product.price;

    let transactionId = null;

    // Si paiement wallet, vérifier et débiter
    if (paymentMethod === "wallet") {
      const walletDoc = await admin
        .firestore()
        .collection("wallets")
        .doc(userId)
        .get();

      if (!walletDoc.exists) {
        return res.status(400).json({
          success: false,
          message: "Wallet introuvable",
        });
      }

      const walletData = walletDoc.data();
      const currentBalance = walletData.balance || 0;

      if (currentBalance < orderPrice) {
        return res.status(400).json({
          success: false,
          message: "Solde insuffisant",
        });
      }

      // Débiter le wallet
      await admin
        .firestore()
        .collection("wallets")
        .doc(userId)
        .update({
          balance: admin.firestore.FieldValue.increment(-orderPrice),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Enregistrer la transaction
      const transactionRef = await admin
        .firestore()
        .collection("wallet_transactions")
        .add({
          userId,
          type: "ecommerce_purchase",
          amount: -orderPrice,
          productId,
          productName: product.name,
          promoCode: promoCode || null,
          promoDiscount: promoDiscount || 0,
          status: "completed",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      transactionId = transactionRef.id;
    }

    // Si un code promo a été utilisé, incrémenter son compteur
    if (promoCode) {
      const promoSnapshot = await admin
        .firestore()
        .collection("promo_codes")
        .where("code", "==", promoCode.toUpperCase())
        .limit(1)
        .get();

      if (!promoSnapshot.empty) {
        const promoDoc = promoSnapshot.docs[0];
        await promoDoc.ref.update({
          usageCount: admin.firestore.FieldValue.increment(1),
        });
      }
    }

    // Créer la commande
    const orderData = {
      userId,
      userName: userData?.firstName
        ? `${userData.firstName} ${userData.lastName || ""}`
        : "Utilisateur",
      userPhone: userData?.phoneNumber || "",
      productId,
      productName: product.name,
      productImage: product.image,
      price: product.price,
      finalPrice: orderPrice,
      promoCode: promoCode || null,
      promoDiscount: promoDiscount || 0,
      paymentMethod,
      status: paymentMethod === "wallet" ? "confirmed" : "pending",
      transactionId: transactionId, // Lien vers la transaction wallet
      createdAt: Date.now(),
    };

    await admin.firestore().collection("ecommerce_orders").add(orderData);

    res.json({
      success: true,
      message: "Commande créée avec succès",
    });
  } catch (error) {
    console.error("Erreur création commande:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Annuler une commande
router.post("/order/:orderId/cancel", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { userId } = req.body;

    const orderDoc = await admin
      .firestore()
      .collection("ecommerce_orders")
      .doc(orderId)
      .get();

    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Commande introuvable",
      });
    }

    const order = orderDoc.data();

    // Vérifier que c'est bien l'utilisateur qui a passé la commande
    if (order.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Non autorisé",
      });
    }

    // Ne peut annuler que si pending ou confirmed
    if (!["pending", "confirmed"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "Cette commande ne peut plus être annulée",
      });
    }

    // Si paiement wallet, rembourser
    if (order.paymentMethod === "wallet" && order.transactionId) {
      // Rembourser le wallet
      await admin
        .firestore()
        .collection("wallets")
        .doc(userId)
        .update({
          balance: admin.firestore.FieldValue.increment(order.finalPrice),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Créer une transaction de remboursement
      await admin.firestore().collection("wallet_transactions").add({
        userId,
        type: "ecommerce_refund",
        amount: order.finalPrice,
        productId: order.productId,
        productName: order.productName,
        orderId: orderId,
        status: "completed",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Marquer la transaction originale comme annulée
      if (order.transactionId) {
        await admin
          .firestore()
          .collection("wallet_transactions")
          .doc(order.transactionId)
          .update({
            status: "cancelled",
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      }
    }

    // Décrémenter le compteur du code promo si utilisé
    if (order.promoCode) {
      const promoSnapshot = await admin
        .firestore()
        .collection("promo_codes")
        .where("code", "==", order.promoCode.toUpperCase())
        .limit(1)
        .get();

      if (!promoSnapshot.empty) {
        const promoDoc = promoSnapshot.docs[0];
        await promoDoc.ref.update({
          usageCount: admin.firestore.FieldValue.increment(-1),
        });
      }
    }

    // Mettre à jour le statut de la commande
    await admin.firestore().collection("ecommerce_orders").doc(orderId).update({
      status: "cancelled",
      cancelledAt: Date.now(),
      updatedAt: Date.now(),
    });

    res.json({
      success: true,
      message: "Commande annulée et remboursée",
    });
  } catch (error) {
    console.error("Erreur annulation commande:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Ajouter un commentaire
router.post("/comment", async (req, res) => {
  try {
    const { productId, userId, userName, userPhoto, rating, comment } =
      req.body;

    if (!productId || !userId || !rating || !comment) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Récupérer le produit pour le nom
    const productDoc = await admin
      .firestore()
      .collection("ecommerce_products")
      .doc(productId)
      .get();

    if (!productDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Produit introuvable",
      });
    }

    const product = productDoc.data();

    // Ajouter le commentaire dans Firestore
    await admin
      .firestore()
      .collection("ecommerce_comments")
      .add({
        productId,
        productName: product.name,
        userId,
        userName,
        userPhoto: userPhoto || null,
        rating,
        comment,
        createdAt: Date.now(),
      });

    res.json({
      success: true,
      message: "Commentaire ajouté",
    });
  } catch (error) {
    console.error("Erreur ajout commentaire:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Valider un code promo
router.post("/validate-promo", async (req, res) => {
  try {
    const { code, productId } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Code promo requis",
      });
    }

    // Rechercher le code promo
    const promoSnapshot = await admin
      .firestore()
      .collection("promo_codes")
      .where("code", "==", code.toUpperCase())
      .limit(1)
      .get();

    if (promoSnapshot.empty) {
      return res.json({
        success: false,
        message: "Code promo invalide",
      });
    }

    const promoDoc = promoSnapshot.docs[0];
    const promo = promoDoc.data();

    // Vérifier si le code est actif
    if (!promo.active) {
      return res.json({
        success: false,
        message: "Ce code promo n'est plus actif",
      });
    }

    // Vérifier la date d'expiration (fin de journée)
    if (promo.expiresAt) {
      const expirationDate = new Date(promo.expiresAt);
      // Mettre à 23:59:59 pour inclure toute la journée
      expirationDate.setHours(23, 59, 59, 999);

      if (Date.now() > expirationDate.getTime()) {
        return res.json({
          success: false,
          message: "Ce code promo a expiré",
        });
      }
    }

    // Vérifier la limite d'utilisation
    if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
      return res.json({
        success: false,
        message: "Ce code promo a atteint sa limite d'utilisation",
      });
    }

    res.json({
      success: true,
      discount: promo.discount,
      message: `Réduction de ${promo.discount}% appliquée`,
    });
  } catch (error) {
    console.error("Erreur validation promo:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Récupérer les commandes d'un utilisateur
router.get("/my-orders/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const ordersSnapshot = await admin
      .firestore()
      .collection("ecommerce_orders")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    const orders = ordersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("Erreur récupération commandes:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Récupérer les bannières actives
router.get("/banners", async (req, res) => {
  try {
    const bannersSnapshot = await admin
      .firestore()
      .collection("ecommerce_banners")
      .where("active", "==", true)
      .orderBy("order", "asc")
      .limit(5)
      .get();

    const banners = bannersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({
      success: true,
      banners,
    });
  } catch (error) {
    console.error("Erreur récupération bannières:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Créer une bannière
router.post("/banners", async (req, res) => {
  try {
    const { image, title, description, link, order } = req.body;

    if (!image || !title) {
      return res.status(400).json({
        success: false,
        message: "Image et titre requis",
      });
    }

    // Vérifier le nombre de bannières actives
    const activeBannersSnapshot = await admin
      .firestore()
      .collection("ecommerce_banners")
      .where("active", "==", true)
      .get();

    if (activeBannersSnapshot.size >= 5) {
      return res.status(400).json({
        success: false,
        message: "Maximum 5 bannières actives",
      });
    }

    await admin
      .firestore()
      .collection("ecommerce_banners")
      .add({
        image,
        title,
        description: description || "",
        link: link || null,
        active: true,
        order: order || 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    res.json({
      success: true,
      message: "Bannière créée",
    });
  } catch (error) {
    console.error("Erreur création bannière:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Mettre à jour une bannière
router.put("/banners/:bannerId", async (req, res) => {
  try {
    const { bannerId } = req.params;
    const { image, title, description, link, active, order } = req.body;

    const updateData = {};
    if (image !== undefined) updateData.image = image;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (link !== undefined) updateData.link = link;
    if (active !== undefined) updateData.active = active;
    if (order !== undefined) updateData.order = order;

    await admin
      .firestore()
      .collection("ecommerce_banners")
      .doc(bannerId)
      .update(updateData);

    res.json({
      success: true,
      message: "Bannière mise à jour",
    });
  } catch (error) {
    console.error("Erreur mise à jour bannière:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Supprimer une bannière
router.delete("/banners/:bannerId", async (req, res) => {
  try {
    const { bannerId } = req.params;

    await admin
      .firestore()
      .collection("ecommerce_banners")
      .doc(bannerId)
      .delete();

    res.json({
      success: true,
      message: "Bannière supprimée",
    });
  } catch (error) {
    console.error("Erreur suppression bannière:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

module.exports = router;
