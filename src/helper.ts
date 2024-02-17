let i = 0;
export const uniqueId = (prefix?: string) => {
    i++
    return `${prefix}${i.toString().padStart(10, '0')}`;
};
