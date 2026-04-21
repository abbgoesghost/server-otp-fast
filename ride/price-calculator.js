// Calculateur de prix pour les courses

const VEHICLE_TYPES = {
  yaris: {
    name: "yaris",
    displayName: "Yaris",
    basePrice: 500, // Prix de base en XOF
    pricePerKm: 150, // Prix par kilomètre
    minPrice: 1000, // Prix minimum
    eco: true,
    icon: "🌿",
    image: "yaris.png",
  },
  berline: {
    name: "berline",
    displayName: "Berline",
    basePrice: 800,
    pricePerKm: 200,
    minPrice: 1500,
    eco: false,
    icon: "🚗",
    image: "berline.png",
  },
  suv: {
    name: "suv",
    displayName: "SUV",
    basePrice: 1200,
    pricePerKm: 300,
    minPrice: 2000,
    eco: false,
    icon: "🚙",
    image: "suv.png",
  },
};

class PriceCalculator {
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
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

    return distance; // Distance en km
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  // Calculer le prix pour un type de véhicule
  calculatePrice(distance, vehicleType) {
    const vehicle = VEHICLE_TYPES[vehicleType];

    if (!vehicle) {
      throw new Error("Type de véhicule invalide");
    }

    // Prix = Prix de base + (Distance × Prix par km)
    let price = vehicle.basePrice + distance * vehicle.pricePerKm;

    // Appliquer le prix minimum
    if (price < vehicle.minPrice) {
      price = vehicle.minPrice;
    }

    // Arrondir au multiple de 50 le plus proche
    price = Math.round(price / 50) * 50;

    // Calculer la durée estimée (vitesse moyenne 30 km/h en ville)
    const duration = Math.round((distance / 30) * 60); // en minutes

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
    for (const vehicleType in VEHICLE_TYPES) {
      prices[vehicleType] = this.calculatePrice(distance, vehicleType);
    }

    return {
      distance: Math.round(distance * 100) / 100,
      estimatedDuration: Math.round((distance / 40) * 60), // Estimation: 40 km/h en moyenne, résultat en minutes
      prices: prices,
    };
  }

  // Obtenir les informations d'un véhicule
  getVehicleInfo(vehicleType) {
    return VEHICLE_TYPES[vehicleType] || null;
  }

  // Obtenir tous les types de véhicules
  getAllVehicleTypes() {
    return VEHICLE_TYPES;
  }
}

module.exports = PriceCalculator;
