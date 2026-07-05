/**
 * 格式化文件大小
 * @param bytes 文件大小（字节）
 * @returns 格式化后的文件大小字符串
 */
export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

/**
 * 获取文件类型显示名称
 * @param type MIME 类型
 * @param name 文件名
 * @returns 文件类型标识（如 PDF、DOC、IMG 等）
 */
export const getFileTypeDisplay = (type: string, name: string): string => {
    const extension = name.substring(name.lastIndexOf('.')).toLowerCase();
    const typeMap: Record<string, string> = {
        '.pdf': 'PDF',
        '.doc': 'DOC',
        '.docx': 'DOC',
        '.xls': 'XLS',
        '.xlsx': 'XLS',
        '.ppt': 'PPT',
        '.pptx': 'PPT',
        '.txt': 'TXT',
        '.jpg': 'IMG',
        '.jpeg': 'IMG',
        '.png': 'IMG',
        '.gif': 'IMG',
        '.zip': 'ZIP',
        '.rar': 'RAR',
    };
    return typeMap[extension] || type.split('/')[0].toUpperCase() || 'FILE';
};


