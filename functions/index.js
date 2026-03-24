const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

exports.syncPartnerProfileOnAcceptedLink = onDocumentUpdated("partner_requests/{requestId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  if (!before || !after) {
    return;
  }

  // Only react on transition to accepted.
  if (before.status === after.status || after.status !== "accepted") {
    return;
  }

  const mainUid = after.fromUid;
  const partnerUid = after.respondentUid;

  if (!mainUid || !partnerUid) {
    logger.warn("Missing fromUid/respondentUid in accepted partner request", { requestId: event.params.requestId });
    return;
  }

  if (mainUid === partnerUid) {
    logger.warn("Refusing to sync profile to same uid", { uid: mainUid, requestId: event.params.requestId });
    return;
  }

  const db = admin.firestore();
  const mainRef = db.collection("users").doc(mainUid);
  const partnerRef = db.collection("users").doc(partnerUid);

  const [mainSnap, partnerSnap] = await Promise.all([mainRef.get(), partnerRef.get()]);

  if (!mainSnap.exists) {
    logger.error("Main account not found for accepted partner link", { mainUid, requestId: event.params.requestId });
    return;
  }

  if (!partnerSnap.exists) {
    logger.error("Partner account not found for accepted partner link", { partnerUid, requestId: event.params.requestId });
    return;
  }

  const main = mainSnap.data() || {};

  // Copy encrypted profile + key material directly, no decrypt/re-encrypt.
  const partnerUpdate = {
    mainAccountUid: mainUid,
    accountType: "partner",
    role: "partner",
    partnerUid: mainUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const copyFields = [
    "pinSalt",
    "pinVerifier",
    "wrappedCK",
    "exchangePublicKey",
    "wrappedExchangePrivateKey",
    "wrappedRK",
    "profileName",
    "profilePronouns",
    "partnerName",
    "partnerPronouns",
    "defaultCoupleCoach",
    "personalCoach",
    "subscriptionTier",
    "language",
    "profileId",
    "partnerId",
  ];

  for (const field of copyFields) {
    if (main[field] !== undefined) {
      partnerUpdate[field] = main[field];
    }
  }

  const batch = db.batch();
  batch.update(partnerRef, partnerUpdate);
  batch.update(mainRef, {
    partnerUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(event.data.after.ref, {
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  await db.collection("auditLogs").add({
    userId: mainUid,
    action: "partner_profile_synced_by_cloud_function",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details: {
      partnerUid,
      requestId: event.params.requestId,
      copiedFields: copyFields,
    },
  });

  logger.info("Partner profile sync completed", {
    requestId: event.params.requestId,
    mainUid,
    partnerUid,
  });
});
