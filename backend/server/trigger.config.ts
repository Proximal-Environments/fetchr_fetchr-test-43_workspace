import { defineConfig } from "@trigger.dev/sdk/v3";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: "proj_ditlanusxvlpwbuavhuw",
  runtime: "node",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  deploy: {
    env: {
      FETCHR_HOST_NAME: "trigger",
      SERVER_PORT: "8008",
      NODE_ENV: "production",
      SUPABASE_URL: "http://localhost:5432",
      SUPABASE_KEY: "local-development-key",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fetchr",
      DATABASE_DIRECT_URL:
        "postgresql://postgres:postgres@localhost:5432/fetchr",
      SUPABASE_S3_ACCESS_KEY: "14b4d52eb16436b6ffdc5d6deca07433",
      SUPABASE_S3_SECRET_KEY:
        "6bdfde48730c4bfc7d833c194bb5b07286b23ab88fa32d25795db591b2aa7d75",
      REDIS_URL: "redis://localhost:6380",
      REDIS_USER: "",
      REDIS_PASSWORD: "j8KmP9vL2nQ5xR7tY3wH9mB4",
      REDIS_TLS: "true",
      PINECONE_API_KEY: "a7c25cad-a3b1-48fb-81a2-904289751f3f",
      PINECONE_ENVIRONMENT: "us-east-1-aws",
      OPENAI_API_KEY:
        "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",
      ANTHROPIC_API_KEY:
        "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",
      COHERE_API_KEY: "vjZ8MdPhFikEURvbt4Fg0ZwTyEv2iKBTwCnyWnUH",
      VOYAGE_API_KEY: "pa-RJGVVVFryiOo3XKfO2dy-UGQP8RtbrN1L-E-Vw8ch5I",
      RUNPOD_API_KEY: "SZTMAP70UHXH4EXPIVHBYKHQJKJMPVCBQC6SG5YZ",
      SSH_PUBLIC_KEY:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL6O9NTcazZT6AKj63LzcyfDowhR7WH+68XzB8B++C+7 runpod_key",
      SSH_PRIVATE_KEY:
        "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACC+jvTU3Gs2U+gCo+ty83Mnw6MIUe1h/uvF8wfAfvgvuwAAAJBck8GHXJPB\nhwAAAAtzc2gtZWQyNTUxOQAAACC+jvTU3Gs2U+gCo+ty83Mnw6MIUe1h/uvF8wfAfvgvuw\nAAAEAMzbzJ5w3CwW0Wk3s8nWoFQHk7wXgUaREJvc7jCzGGur6O9NTcazZT6AKj63LzcyfD\nowhR7WH+68XzB8B++C+7AAAACnJ1bnBvZF9rZXkBAgM=\n-----END OPENSSH PRIVATE KEY-----",
      LANGCHAIN_TRACING_V2: "true",
      LANGCHAIN_ENDPOINT: "https://api.smith.langchain.com",
      LANGCHAIN_API_KEY: "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",
      LANGCHAIN_PROJECT: "fetchr-backend",
      DATADOG_SITE: "us3.datadoghq.com",
      DATADOG_API_KEY: "ad1f22b419672abb4169316c52692394",
      DD_API_KEY: "ad1f22b419672abb4169316c52692394",
      DD_SERVICE: "fetchr-backend",
      DD_APP_KEY: "5990579baaffbef99d7d6e4f023f88fb732a9027",
      STRIPE_WEBHOOK_SECRET: "whsec_KLkV3VX7u8HWRmVTsCj4VxvkjvEHLP2f",
      STRIPE_WEBHOOK_SECRET_DEV:
        "whsec_60a555838af2f1035a5a1ee7c74117b2fc4b57809f660d9e81088f4003cda782",
      STRIPE_PUBLISHABLE_KEY:
        "pk_live_51NQhfaDcDdHI3yBzWxvh391eK2tYCFThX6iVDfUiaATDnRmDEFKxASvxSA1d5ymmyGxZ6T4Aam7k2Lou2rxMsmVU00jyqu3hAm",
      STRIPE_SECRET_KEY_TEST:
        "sk_test_51NQhfaDcDdHI3yBzquvcXjC0KIoO9FS13qpppFVNCmKAFzCG3esYGqvWNjy2lSiIgjkLDpKLW7yGsZ7EP9thoyRh00h4SNJaEP",
      STRIPE_TEST_PUBLISHABLE_KEY:
        "pk_test_51NQhfaDcDdHI3yBz4JvE63m0J15Zn0FRuTWEaDIhsIVZObpwhLc64DKrV3e5gtWjvGJW1PSV25Smtg2Z1d98SL8l00Vm5sxXYw",
      STRIPE_SECRET_KEY_LIVE:
        "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",
      STRIPE_PUBLISHABLE_KEY_TEST:
        "pk_test_51NQhfaDcDdHI3yBz4JvE63m0J15Zn0FRuTWEaDIhsIVZObpwhLc64DKrV3e5gtWjvGJW1PSV25Smtg2Z1d98SL8l00Vm5sxXYw",
      STRIPE_PUBLISHABLE_KEY_LIVE:
        "pk_live_51NQhfaDcDdHI3yBzWxvh391eK2tYCFThX6iVDfUiaATDnRmDEFKxASvxSA1d5ymmyGxZ6T4Aam7k2Lou2rxMsmVU00jyqu3hAm",
      STRIPE_MERCHANT_ID: "merchant.com.fetchr",
      STRIPE_SUBSCRIPTION_PRICE_ID_TEST: "price_1QmBpYDcDdHI3yBznFwyH3ki",
      STRIPE_SUBSCRIPTION_PRICE_ID_LIVE: "price_1Ql3tUDcDdHI3yBzR96b3YcC",
      NYLAS_CLIENT_ID: "b8e2b4e0-7b1a-4b3c-8d9e-0f1a2b3c4d5e",
      NYLAS_CLIENT_SECRET: "nylas_client_secret_1234567890abcdef",
      NYLAS_API_URI: "https://api.us.nylas.com",
      AFTERSHIP_API_KEY: "asat_c7c62baa7f7849dbacf462f646ce831d",
      PARCELS_APP_API_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiI0NGZhN2ZjMC0xZjFmLTExZjAtYTRlMi01ZGFiY2Q0NDUwMWEiLCJzdWJJZCI6IjY4MDZmYjE5ZDA2NWNmNzlkYzVhNDBiZSIsImlhdCI6MTc0NTI4Nzk2MX0.QCiZqU-Jjwqq1vH5GfIr6NaaO_EoUk7vN9Wxe5RZ8xQ",
      GROQ_API_KEY: "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",
      TRIGGER_SECRET_KEY: "tr_prod_529kCCZXCeWDLwPdULOJ",
    },
  },
  dirs: ["./src/trigger"],
  // Add build configuration with Prisma extension
  build: {
    extensions: [
      prismaExtension({
        schema: "./schema.prisma", // Path to your schema file relative to the trigger.config.ts
      }),
    ],
    external: [
      "@priompt",
      "@grpc/grpc-js",
      "@opentelemetry/otlp-exporter-base",
      "mock-aws-s3",
      "aws-sdk",
      "nock",
      "fsevents",
      "encoding",
      "@middleware.io/node-apm",
      "onnxruntime-node",
      "sharp",
      "playwright",
      "@playwright/test",
      "@browserbasehq/stagehand",
    ],
  },
});
