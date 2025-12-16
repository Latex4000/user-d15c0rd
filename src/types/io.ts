export interface LocalFile {
    path: string;
    originalName: string;
    mimeType?: string;
    fieldName?: string;
}

export interface UploadedMedia {
    youtubeUrl?: string | null;
    soundcloudUrl?: string | null;
}
