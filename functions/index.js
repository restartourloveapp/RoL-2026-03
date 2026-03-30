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

async function wipeAccountDataBeforePartnerConversion(userId) {
  const db = admin.firestore();

  const sessionsSnap = await db.collection("sessions")
    .where("ownerUid", "==", userId)
    .get();

  for (const sessionDoc of sessionsSnap.docs) {
    const session = sessionDoc.data() || {};
    if (session.type !== "personal") {
      continue;
    }

    const [messagesSnap, summariesSnap] = await Promise.all([
      sessionDoc.ref.collection("messages").get(),
      sessionDoc.ref.collection("message_summaries").get(),
    ]);

    for (const doc of messagesSnap.docs) {
      await doc.ref.delete();
    }
    for (const doc of summariesSnap.docs) {
      await doc.ref.delete();
    }

    await sessionDoc.ref.delete();
  }

  const [timelineSnap, homeworkSnap] = await Promise.all([
    db.collection("timeline").where("ownerUid", "==", userId).get(),
    db.collection("homework").where("ownerUid", "==", userId).get(),
  ]);

  for (const doc of timelineSnap.docs) {
    await doc.ref.delete();
  }
  for (const doc of homeworkSnap.docs) {
    await doc.ref.delete();
  }
}

async function migratePartnerPersonalDataToPartnerProfile(mainAccountUid, partnerAccountUid, partnerProfileId) {
  const counters = { sessions: 0, timeline: 0, homework: 0 };
  if (!partnerProfileId) {
    return counters;
  }

  const db = admin.firestore();
  const personalSessionsSnap = await db.collection("sessions")
    .where("ownerUid", "==", mainAccountUid)
    .where("type", "==", "personal")
    .get();

  for (const sessionDoc of personalSessionsSnap.docs) {
    const session = sessionDoc.data() || {};
    if (session.ownerProfileId !== partnerProfileId) {
      continue;
    }

    await sessionDoc.ref.update({
      ownerUid: partnerAccountUid,
      partnerUid: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    counters.sessions++;

    const timelineSnap = await db.collection("timeline")
      .where("sessionId", "==", sessionDoc.id)
      .where("ownerUid", "==", mainAccountUid)
      .get();

    for (const entry of timelineSnap.docs) {
      await entry.ref.update({
        ownerUid: partnerAccountUid,
        partnerUid: admin.firestore.FieldValue.delete(),
      });
      counters.timeline++;
    }

    const homeworkSnap = await db.collection("homework")
      .where("sessionId", "==", sessionDoc.id)
      .where("ownerUid", "==", mainAccountUid)
      .get();

    for (const task of homeworkSnap.docs) {
      await task.ref.update({
        ownerUid: partnerAccountUid,
        partnerUid: admin.firestore.FieldValue.delete(),
      });
      counters.homework++;
    }
  }

  return counters;
}

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

exports.connectAsPartnerDevice = onCall({
  region: "europe-west1",
}, async (request) => {
  const partnerAccountUid = request.auth?.uid;
  const connectionCode = typeof request.data?.connectionCode === "string"
    ? request.data.connectionCode.trim().toUpperCase()
    : "";

  if (!partnerAccountUid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  if (connectionCode.length !== 6) {
    throw new HttpsError("invalid-argument", "Invalid connection code.");
  }

  const db = admin.firestore();
  const codesSnap = await db.collection("partnerConnectionCodes")
    .where("code", "==", connectionCode)
    .limit(1)
    .get();

  if (codesSnap.empty) {
    throw new HttpsError("not-found", "Connection code not found or expired.");
  }

  const codeDoc = codesSnap.docs[0];
  const codeData = codeDoc.data() || {};
  const expiresAt = codeData.expiresAt?.toDate?.();

  if (!expiresAt || expiresAt < new Date()) {
    throw new HttpsError("deadline-exceeded", "Connection code has expired.");
  }

  if (codeData.used) {
    throw new HttpsError("already-exists", "Connection code has already been used.");
  }

  const mainAccountUid = codeData.mainAccountUid;
  if (!mainAccountUid || mainAccountUid === partnerAccountUid) {
    throw new HttpsError("failed-precondition", "Invalid connection code for this account.");
  }

  const mainAccountSnap = await db.collection("users").doc(mainAccountUid).get();
  if (!mainAccountSnap.exists) {
    throw new HttpsError("not-found", "Main account not found.");
  }

  const mainAccountData = mainAccountSnap.data() || {};
  if (mainAccountData.subscriptionTier !== "paid") {
    throw new HttpsError("permission-denied", "Main account must be premium to create partner devices.");
  }

  if (!mainAccountData.pinSalt || !mainAccountData.pinVerifier || !mainAccountData.wrappedCK) {
    throw new HttpsError("failed-precondition", "Main account PIN not properly configured.");
  }

  await wipeAccountDataBeforePartnerConversion(partnerAccountUid);

  const partnerProfileId = typeof mainAccountData.partnerId === "string" && mainAccountData.partnerId
    ? mainAccountData.partnerId
    : mainAccountData.profileId;
  const mainProfileId = typeof mainAccountData.profileId === "string"
    ? mainAccountData.profileId
    : null;

  await db.collection("users").doc(partnerAccountUid).update({
    mainAccountUid,
    accountType: "partner",
    role: "partner",
    pinSalt: mainAccountData.pinSalt,
    pinVerifier: mainAccountData.pinVerifier,
    wrappedCK: mainAccountData.wrappedCK,
    exchangePublicKey: mainAccountData.exchangePublicKey || null,
    wrappedExchangePrivateKey: mainAccountData.wrappedExchangePrivateKey || null,
    wrappedRK: mainAccountData.wrappedRK || null,
    subscriptionTier: "partner",
    language: mainAccountData.language || "nl",
    defaultCoupleCoach: mainAccountData.defaultCoupleCoach || null,
    profileId: partnerProfileId,
    partnerId: mainProfileId,
    profileName: mainAccountData.partnerName || null,
    profilePronouns: mainAccountData.partnerPronouns || null,
    partnerName: mainAccountData.profileName || null,
    partnerPronouns: mainAccountData.profilePronouns || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection("users").doc(mainAccountUid).update({
    partnerUid: partnerAccountUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const migration = await migratePartnerPersonalDataToPartnerProfile(
    mainAccountUid,
    partnerAccountUid,
    partnerProfileId
  );

  await codeDoc.ref.update({
    used: true,
    partnerAccountUid,
    usedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection("auditLogs").add({
    userId: partnerAccountUid,
    action: "partner_device_connected",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details: {
      mainAccountUid,
      connectionCode,
      via: "callable",
      migration,
    },
  });

  await db.collection("auditLogs").add({
    userId: mainAccountUid,
    action: "partner_device_link_confirmed",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details: {
      partnerAccountUid,
      connectionCode,
      via: "callable",
      migration,
    },
  });

  return {
    success: true,
    mainAccountUid,
    migration,
  };
});
