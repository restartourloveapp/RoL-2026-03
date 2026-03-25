const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

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
  "subscriptionTier",
  "language",
  "profileId",
  "partnerId",
];

async function syncSharedMainToPartner(mainUid, partnerUid, requestId = null) {
  if (!mainUid || !partnerUid || mainUid === partnerUid) {
    return;
  }

  const db = admin.firestore();
  const mainRef = db.collection("users").doc(mainUid);
  const partnerRef = db.collection("users").doc(partnerUid);
  const [mainSnap, partnerSnap] = await Promise.all([mainRef.get(), partnerRef.get()]);

  if (!mainSnap.exists || !partnerSnap.exists) {
    logger.warn("Skipping sync: main or partner profile missing", { mainUid, partnerUid, requestId });
    return;
  }

  const main = mainSnap.data() || {};
  const partnerUpdate = {
    mainAccountUid: mainUid,
    accountType: "partner",
    role: "partner",
    partnerUid: mainUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

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
  await batch.commit();
}

exports.syncPartnerProfileOnAcceptedLink = onDocumentUpdated({
  document: "partner_requests/{requestId}",
  region: "europe-west1",
}, async (event) => {
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
  await syncSharedMainToPartner(mainUid, partnerUid, event.params.requestId);

  await event.data.after.ref.update({
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

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

exports.syncPartnerProfileOnMainProfileUpdate = onDocumentUpdated({
  document: "users/{userId}",
  region: "europe-west1",
}, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const mainUid = event.params.userId;

  // Sync only from main/owner account docs, never from partner docs.
  const isPartnerDoc = after.accountType === "partner" || after.role === "partner" || !!after.mainAccountUid;
  if (isPartnerDoc) {
    return;
  }

  const partnerUid = after.partnerUid;
  if (!partnerUid) {
    return;
  }

  // Avoid unnecessary writes if no shared field changed and partner link is unchanged.
  const tracked = ["partnerUid", ...copyFields];
  const changed = tracked.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  if (!changed) {
    return;
  }

  await syncSharedMainToPartner(mainUid, partnerUid);

  await admin.firestore().collection("auditLogs").add({
    userId: mainUid,
    action: "partner_profile_synced_on_main_profile_update",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details: {
      partnerUid,
      trigger: "users_on_update",
    },
  });

  logger.info("Partner profile sync (main update) completed", { mainUid, partnerUid });
});

exports.forcePartnerSettingsSync = onCall({
  region: "europe-west1",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const db = admin.firestore();
  const partnerSnap = await db.collection("users").doc(uid).get();
  if (!partnerSnap.exists) {
    throw new HttpsError("not-found", "Partner profile not found.");
  }

  const partnerData = partnerSnap.data() || {};
  let mainUid = partnerData.mainAccountUid || partnerData.partnerUid || null;

  // Legacy fallback: resolve main account by reverse relationship lookup.
  if (!mainUid) {
    const reverseSnap = await db.collection("users")
      .where("partnerUid", "==", uid)
      .limit(1)
      .get();
    if (!reverseSnap.empty) {
      mainUid = reverseSnap.docs[0].id;
    }
  }

  // Do not fail hard for partially linked states; just return a soft result.
  if (!mainUid || mainUid === uid) {
    return { success: false, reason: "not-linked" };
  }

  await syncSharedMainToPartner(mainUid, uid, "callable_fallback");

  await db.collection("auditLogs").add({
    userId: uid,
    action: "partner_profile_sync_forced_from_settings",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details: {
      mainUid,
      trigger: "callable",
    },
  });

  return { success: true, mainUid };
});
