#!/usr/bin/env node

/**
 * Script pour mettre à jour l'URL Ngrok dans paytech-manager.js
 *
 * Usage:
 *   node update-ngrok-url.js https://votre-nouvelle-url.ngrok-free.app
 */

const fs = require("fs");
const path = require("path");

const newUrl = process.argv[2];

if (!newUrl) {
  console.error("❌ Erreur: URL Ngrok manquante");
  console.log("\nUsage:");
  console.log("  node update-ngrok-url.js https://votre-url.ngrok-free.app");
  console.log("\nExemple:");
  console.log("  node update-ngrok-url.js https://abc123.ngrok-free.app");
  process.exit(1);
}

if (!newUrl.startsWith("https://") || !newUrl.includes("ngrok")) {
  console.error("❌ Erreur: URL invalide. Doit être une URL Ngrok HTTPS");
  console.log("\nExemple valide:");
  console.log("  https://abc123.ngrok-free.app");
  process.exit(1);
}

const filePath = path.join(__dirname, "payment", "paytech-manager.js");

try {
  let content = fs.readFileSync(filePath, "utf8");

  // Remplacer toutes les occurrences de l'ancienne URL
  const oldUrlPattern = /https:\/\/[a-z0-9-]+\.ngrok-free\.(dev|app)/g;
  const matches = content.match(oldUrlPattern);

  if (matches) {
    const oldUrl = matches[0];
    console.log(`🔄 Remplacement de: ${oldUrl}`);
    console.log(`✅ Par: ${newUrl}`);

    content = content.replace(oldUrlPattern, newUrl);

    fs.writeFileSync(filePath, content, "utf8");

    console.log("\n✅ Fichier mis à jour avec succès!");
    console.log("\n📝 Prochaines étapes:");
    console.log("  1. Redémarrez le serveur: node server.js");
    console.log("  2. Testez le paiement dans l'app");
  } else {
    console.log("⚠️  Aucune URL Ngrok trouvée dans le fichier");
    console.log("Le fichier utilise peut-être déjà la bonne URL");
  }
} catch (error) {
  console.error("❌ Erreur:", error.message);
  process.exit(1);
}
