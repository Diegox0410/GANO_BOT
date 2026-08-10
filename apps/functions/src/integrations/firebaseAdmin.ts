import {
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";

import {
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";

export interface GanoFirebaseAdminEnvironment {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
}

function requiredEnvironmentValue(
  key: string,
): string {
  const value =
    process.env[key]?.trim();

  if (!value) {
    throw new Error(
      `[GANO_BOT] Falta la variable de entorno ${key}.`,
    );
  }

  return value;
}

function normalizePrivateKey(
  value: string,
): string {
  return value.replace(
    /\\n/g,
    "\n",
  );
}

export function readGanoFirebaseAdminEnvironment():
  GanoFirebaseAdminEnvironment {
  return Object.freeze({
    projectId:
      requiredEnvironmentValue(
        "FIREBASE_ADMIN_PROJECT_ID",
      ),

    clientEmail:
      requiredEnvironmentValue(
        "FIREBASE_ADMIN_CLIENT_EMAIL",
      ),

    privateKey:
      normalizePrivateKey(
        requiredEnvironmentValue(
          "FIREBASE_ADMIN_PRIVATE_KEY",
        ),
      ),
  });
}

let cachedApp:
  App | undefined;

let cachedFirestore:
  Firestore | undefined;

export function getGanoFirebaseAdminApp():
  App {
  if (cachedApp) {
    return cachedApp;
  }

  const existing =
    getApps()[0];

  if (existing) {
    cachedApp =
      existing;

    return cachedApp;
  }

  const environment =
    readGanoFirebaseAdminEnvironment();

  cachedApp =
    initializeApp({
      credential:
        cert({
          projectId:
            environment.projectId,

          clientEmail:
            environment.clientEmail,

          privateKey:
            environment.privateKey,
        }),

      projectId:
        environment.projectId,
    });

  return cachedApp;
}

export function getGanoAdminFirestore():
  Firestore {
  if (cachedFirestore) {
    return cachedFirestore;
  }

  cachedFirestore =
    getFirestore(
      getGanoFirebaseAdminApp(),
    );

  cachedFirestore.settings({
    ignoreUndefinedProperties:
      true,
  });

  return cachedFirestore;
}