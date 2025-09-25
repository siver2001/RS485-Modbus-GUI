const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const ModbusRTU = require("modbus-serial");

// --- Cấu hình ---
const client = new ModbusRTU();
const SLAVE_ID = 1;

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false
        }
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // Bỏ comment để mở công cụ debug
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (client.isOpen) {
        client.close();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// --- Xử lý Logic Modbus và SerialPort ---

// Lắng nghe yêu cầu lấy danh sách cổng COM từ giao diện
ipcMain.handle('get-com-ports', async () => {
    try {
        const ports = await SerialPort.list();
        return ports;
    } catch (error) {
        console.error("Lỗi khi liệt kê cổng COM:", error);
        return [];
    }
});

// Lắng nghe yêu cầu kết nối
ipcMain.handle('connect-modbus', async (event, options) => {
    if (client.isOpen) {
        await client.close();
    }
    try {
        // Thêm 'dataBits' vào đối tượng cấu hình
        await client.connectRTUBuffered(options.comPath, {
            baudRate: parseInt(options.baudRate),
            parity: options.parity,
            stopBits: parseInt(options.stopBits),
            dataBits: parseInt(options.dataBits), // <-- Dòng được thêm vào
        });
        client.setID(SLAVE_ID);
        return { success: true, message: `Kết nối thành công tới ${options.comPath}` };
    } catch (error) {
        return { success: false, message: `Lỗi kết nối: ${error.message}` };
    }
});

// Lắng nghe yêu cầu ngắt kết nối
ipcMain.handle('disconnect-modbus', async () => {
    if (client.isOpen) {
        await client.close();
        return { success: true, message: 'Đã ngắt kết nối.' };
    }
    return { success: false, message: 'Không có kết nối nào đang mở.' };
});


// Lắng nghe yêu cầu đọc thanh ghi
ipcMain.handle('read-register', async (event, { address, count }) => {
    if (!client.isOpen) {
        return { success: false, message: "Lỗi: Chưa kết nối." };
    }
    try {
        const data = await client.readHoldingRegisters(address, count);
        return { success: true, data: data.data };
    } catch (e) {
        return { success: false, message: `Lỗi khi đọc thanh ghi: ${e.message}` };
    }
});

// Lắng nghe yêu cầu ghi thanh ghi
ipcMain.handle('write-register', async (event, { address, value }) => {
    if (!client.isOpen) {
        return { success: false, message: "Lỗi: Chưa kết nối." };
    }
    try {
        await client.writeRegister(address, value);
        return { success: true, message: `Ghi thành công. Địa chỉ: ${address}, Giá trị: ${value}` };
    } catch (e) {
        return { success: false, message: `Lỗi khi ghi thanh ghi: ${e.message}` };
    }
});
ipcMain.handle('test-connection', async (event, { connectionOptions, slaveId }) => {
    // Tạo một client tạm thời chỉ để kiểm tra
    const testClient = new ModbusRTU();

    try {
        // 1. Kết nối với các tùy chọn được cung cấp
        await testClient.connectRTUBuffered(connectionOptions.comPath, {
            baudRate: parseInt(connectionOptions.baudRate),
            parity: connectionOptions.parity,
            stopBits: parseInt(connectionOptions.stopBits),
            dataBits: parseInt(connectionOptions.dataBits),
        });

        // 2. Đặt ID và một thời gian chờ ngắn để kiểm tra nhanh
        testClient.setID(parseInt(slaveId));
        testClient.setTimeout(1000); // Chờ tối đa 1 giây

        // 3. Thử đọc một thanh ghi đơn giản (địa chỉ 0, 1 thanh ghi)
        // Mục đích không phải là lấy dữ liệu, mà là để xem thiết bị có trả lời không
        await testClient.readHoldingRegisters(0, 1);

        // 4. Nếu dòng lệnh trên không báo lỗi, nghĩa là đã có phản hồi
        return { success: true, message: `✅ Thành công! Thiết bị với Slave ID ${slaveId} đã phản hồi.` };

    } catch (error) {
        // 5. Nếu có lỗi (thường là timeout), nghĩa là không có phản hồi
        return { success: false, message: `❌ Thất bại. Không nhận được phản hồi từ Slave ID ${slaveId}. Vui lòng kiểm tra lại dây dẫn, Slave ID, và các cài đặt.` };

    } finally {
        // 6. Rất quan trọng: Luôn luôn đóng kết nối tạm thời sau khi kiểm tra xong
        if (testClient.isOpen) {
            testClient.close();
        }
    }
});