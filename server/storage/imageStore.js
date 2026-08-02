import { createFilesystemObjectStorage } from '../infrastructure/objectStorage/filesystemObjectStorage.js';

// 既存route/storage module向け互換名。画像APIの実体はObjectStorage portへ移行済み。
export const createFsImageStore = createFilesystemObjectStorage;
