
export const isEmptyObject = (obj: unknown): boolean => {
    return !!obj && Object.keys(obj).length === 0 && obj.constructor === Object
}

let i = 0;
export const uniqueId = (prefix?: string): string => {
    i++
    return `${prefix}${i.toString().padStart(10, '0')}`;
};
