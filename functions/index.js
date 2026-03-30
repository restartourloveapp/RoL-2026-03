const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

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
    subscriptionTier: "partner",
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

exports.getLinkedAccountSummary = onCall({
  region: "europe-west1",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const db = admin.firestore();
  const selfSnap = await db.collection("users").doc(uid).get();
  if (!selfSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const self = selfSnap.data() || {};
  const isPartner = self.accountType === "partner" || self.role === "partner" || !!self.mainAccountUid;
  const linkedUid = isPartner ? (self.mainAccountUid || self.partnerUid) : self.partnerUid;

  if (!linkedUid || linkedUid === uid) {
    return { success: false, reason: "not-linked" };
  }

  const linkedSnap = await db.collection("users").doc(linkedUid).get();
  if (!linkedSnap.exists) {
    return { success: false, reason: "linked-profile-not-found" };
  }

  const linked = linkedSnap.data() || {};
  return {
    success: true,
    linkedUid,
    linkedDisplayName: linked.displayName || "",
    linkedEmail: linked.email || "",
    relation: isPartner ? "main-account" : "partner-account",
  };
});

exports.generatePartnerConnectionCode = onCall({
  region: "europe-west1",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const userData = userSnap.data() || {};
  const tier = userData.subscriptionTier || "free";
  if (tier !== "paid") {
    throw new HttpsError("permission-denied", "Main account must be premium to create partner accounts");
  }

  const code = crypto.randomBytes(3).toString("hex").toUpperCase().substring(0, 6);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.collection("partnerConnectionCodes").add({
    mainAccountUid: uid,
    code,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    used: false,
    partnerAccountUid: null,
  });

  await db.collection("auditLogs").add({
    userId: uid,
    action: "partner_connection_code_generated",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details: {
      code,
      expiresAt,
      via: "callable",
    },
  });

  return {
    success: true,
    code,
    expiresAt: expiresAt.toISOString(),
  };
});
