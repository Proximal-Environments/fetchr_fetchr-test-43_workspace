import { readFileSync } from 'fs';

const getHost = (): string | undefined => {
  let hostname = undefined;
  try {
    hostname = readFileSync('.hostname', 'utf-8').trim();
  } catch (e) {
    console.warn(`Failed to read .hostname file. Please create one in the /server folder ${e}`);
    // Fallback to environment variable if file read fails
    hostname = process.env.FETCHR_HOST_NAME;
  }
  return hostname;
};

export const hostname = getHost();
