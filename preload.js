const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Hàm gọi từ renderer tới main
    getComPorts: () => ipcRenderer.invoke('get-com-ports'),
    connectModbus: (options) => ipcRenderer.invoke('connect-modbus', options),
    disconnectModbus: () => ipcRenderer.invoke('disconnect-modbus'),
    readRegister: (params) => ipcRenderer.invoke('read-register', params),
    writeRegister: (params) => ipcRenderer.invoke('write-register', params),
    testConnection: (options) => ipcRenderer.invoke('test-connection', options)
    // Hàm nhận dữ liệu từ main tới renderer (nếu cần)
    // on: (channel, callback) => {
    //     ipcRenderer.on(channel, (event, ...args) => callback(...args));
    // }
});