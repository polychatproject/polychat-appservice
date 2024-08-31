
export const isEmptyObject = (obj: unknown): boolean => {
    return !!obj && Object.keys(obj).length === 0 && obj.constructor === Object
}

// The session prefix avoids collisions with other
const sessionPrefix = `_${new Date().getTime()}_`;
let i = 0;
export const uniqueId = (prefix?: string): string => {
    i++
    return `${prefix}${sessionPrefix}${i.toString().padStart(8, '0')}`;
};
