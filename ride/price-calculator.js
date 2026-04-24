// Calculateur de prix pour les courses
const admin = require("../config/firebase-admin");

// Prix par défaut (fallback si Realtime Database n'est pas disponible)
const DEFAULT_VEHICLE_TYPES = {
  yaris: {
    name: "yaris",
    displayName: "Yaris",
    basePrice: 500,
    pricePerKm: 250,
    minPrice: 1000,
    eco: true,
    icon: "🌿",
    image: "yaris.png",
  },
  berline: {
    name: "berline",
    displayName: "Berline",
    basePrice: 800,
    pricePerKm: 300,
    minPrice: 1500,
    eco: false,
    icon: "🚗",
    image: "berline.png",
  },
  suv: {
    name: "suv",
    displayName: "SUV",
    basePrice: 1200,
    pricePerKm: 400,
    minPrice: 2000,
    eco: false,
    icon: "🚙",
    image: "suv.png",
  },
};

class PriceCalculator {
  constructor() {
    this.vehicleTypes = DEFAULT_VEHICLE_TYPES;
    this.setupRealtimeListener();
  }

  // Écouter les changements de prix en temps réel
  setupRealtimeListener() {
    const db = admin.database();
    const pricingRef = db.ref("settings/pricing");

    console.log(
      "🔄 Initialisation du listener Realtime Database pour les prix...",
    );

    // Listener en temps réel
    pricingRef.on(
      "value",
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          this.vehicleTypes = data;
          console.log(
            "🔄 Prix mis à jour en temps réel depuis Realtime Database:",
          );
          console.log("   Yaris:", JSON.stringify(data.yaris));
          console.log("   Berline:", JSON.stringify(data.berline));
          console.log("   SUV:", JSON.stringify(data.suv));
        } else {
          // Créer les prix par défaut si ils n'existent pas
          console.log("⚠️ Aucun prix trouvé, création des prix par défaut...");
          pricingRef.set(DEFAULT_VEHICLE_TYPES);
          console.log("✅ Prix par défaut créés dans Realtime Database");
        }
      },
      (error) => {
        console.error("⚠️ Erreur listener pricing:", error);
        console.log("📦 Utilisation des prix par défaut en fallback");
        this.vehicleTypes = DEFAULT_VEHICLE_TYPES;
      },
    );
  }
  calculateDistance(lat1, lon1, lat2, lon2) {
    console.log("📍 Calcul distance:", { lat1, lon1, lat2, lon2 });

    const R = 6371; // Rayon de la Terre en km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    console.log("📏 Distance calculée:", distance.toFixed(2), "km");
    return distance; // Distance en km
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  // Calculer le prix pour un type de véhicule
  calculatePrice(distance, vehicleType) {
    const vehicle = this.vehicleTypes[vehicleType];

    if (!vehicle) {
      throw new Error("Type de véhicule invalide");
    }

    console.log(`🔍 Calcul pour ${vehicle.displayName}:`);
    console.log(`   Base: ${vehicle.basePrice} XOF`);
    console.log(`   Par km: ${vehicle.pricePerKm} XOF`);
    console.log(`   Minimum: ${vehicle.minPrice} XOF`);

    // Prix = Prix de base + (Distance × Prix par km)
    let price = vehicle.basePrice + distance * vehicle.pricePerKm;
    console.log(
      `   Calcul brut: ${vehicle.basePrice} + (${distance.toFixed(2)} × ${vehicle.pricePerKm}) = ${price.toFixed(2)} XOF`,
    );

    // Appliquer le prix minimum
    if (price < vehicle.minPrice) {
      console.log(
        `   ⚠️ Prix ${price.toFixed(2)} < Minimum ${vehicle.minPrice}, application du minimum`,
      );
      price = vehicle.minPrice;
    }

    // Arrondir au multiple de 50 le plus proche
    const priceBefore = price;
    price = Math.round(price / 50) * 50;
    console.log(`   Arrondi: ${priceBefore.toFixed(2)} → ${price} XOF`);

    // Calculer la durée estimée (vitesse moyenne 30 km/h en ville)
    const duration = Math.max(1, Math.round((distance / 30) * 60)); // en minutes, minimum 1 minute

    console.log(
      `💰 ${vehicle.displayName}: ${distance.toFixed(2)} km, ${duration} min, ${price} XOF`,
    );

    return {
      vehicleType: vehicle.name,
      displayName: vehicle.displayName,
      distance: Math.round(distance * 100) / 100, // Arrondir à 2 décimales
      duration: duration, // Durée en minutes
      price: price,
      basePrice: vehicle.basePrice,
      pricePerKm: vehicle.pricePerKm,
      eco: vehicle.eco,
      icon: vehicle.icon,
      image: vehicle.image,
    };
  }

  // Calculer les prix pour tous les types de véhicules
  calculateAllPrices(fromLat, fromLng, toLat, toLng) {
    const distance = this.calculateDistance(fromLat, fromLng, toLat, toLng);

    const prices = {};
    for (const vehicleType in this.vehicleTypes) {
      prices[vehicleType] = this.calculatePrice(distance, vehicleType);
    }

    // Durée estimée globale (vitesse moyenne 35 km/h en ville)
    const estimatedDuration = Math.max(1, Math.round((distance / 35) * 60));

    return {
      distance: Math.round(distance * 100) / 100,
      estimatedDuration: estimatedDuration,
      prices: prices,
    };
  }

  // Obtenir les informations d'un véhicule
  getVehicleInfo(vehicleType) {
    return this.vehicleTypes[vehicleType] || null;
  }

  // Obtenir tous les types de véhicules
  getAllVehicleTypes() {
    return this.vehicleTypes;
  }
}

module.exports = PriceCalculator;
