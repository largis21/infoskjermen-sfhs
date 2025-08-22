import { AzureOpenAI } from "openai";
import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { parseICS } from "node-ical";
import { BlobServiceClient } from "@azure/storage-blob";

const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "";

const credential = new DefaultAzureCredential();
const apiVersion = "2024-10-21";
const scope = "https://cognitiveservices.azure.com/.default";
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

const client = new AzureOpenAI({
  endpoint,
  apiVersion,
  // azureADTokenProvider,
  apiKey: process.env.AZURE_OPENAI_API_KEY || "",
});

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING || ""
);

export async function test(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const infoskjermenHtml = await fetch(
    "https://app.pintomind.com/remote/boards/info25/posts"
  ).then((res) => res.text());

  let validICS = "";
  let i = 0;
  let maxRetries = 3;

  while (!validICS && i < maxRetries) {
    const response = await client.chat.completions
      .create({
        messages: [
          {
            role: "system",
            content:
              "You will be given a html document of a school plan. Scan the document and extract the events from the plan. You must respond with a ics calendar file.",
          },
          { role: "user", content: infoskjermenHtml },
        ],
        model: "gpt-5-nano",
      })
      .then((res) => res.choices[0].message.content);

    const events = parseICS(response);

    if (JSON.stringify(events) !== "{}") {
      validICS = response;
    }
    i++;
  }

  const blob = new Blob([validICS], { type: "text/calendar" });

  const containerName = "calendar";
  const blobName = "cal.ics";

  // Get container client
  const containerClient = blobServiceClient.getContainerClient(containerName);

  // Ensure container exists
  await containerClient.createIfNotExists();

  // Get block blob client
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // Upload
  await blockBlobClient.uploadData(Buffer.from(validICS));

  console.log(`Upload successful: ${blobName}`);

  return { body: validICS };
}

app.http("test", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: test,
});
