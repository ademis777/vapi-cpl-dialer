import fs from 'node:fs';
import path from 'node:path';

export function migrateCampaignProfiles(legacyDir: string, persistentDir: string) {
  fs.mkdirSync(persistentDir, { recursive: true });
  const persistentProfiles = fs.readdirSync(persistentDir).filter(name => name.toLowerCase().endsWith('.json'));
  if (persistentProfiles.length || !fs.existsSync(legacyDir)) return { migrated: 0, skipped: persistentProfiles.length };
  let migrated = 0;
  for (const name of fs.readdirSync(legacyDir).filter(item => item.toLowerCase().endsWith('.json'))) {
    const source = path.join(legacyDir, name), target = path.join(persistentDir, path.basename(name));
    if (fs.existsSync(target)) continue;
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); migrated += 1;
  }
  return { migrated, skipped: 0 };
}
