const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const ModbusRTU = require('modbus-serial');
const SerialPort = require('serialport'); // Hoặc `@serialport/bindings` nếu bạn dùng phiên bản mới

let mainWindow;
let client = new ModbusRTU();
let isPortOpen = false; // Biến để theo dõi trạng thái cổng Serial

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1920, // Tăng chiều rộng để giao diện thoải mái hơn
        height: 1080, // Tăng chiều cao
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // Bỏ comment để mở DevTools
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
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Hàm kiểm tra cổng COM đang mở hay không
function checkPortStatus() {
    // client.isOpen là thuộc tính của modbus-serial, kiểm tra xem cổng có mở không
    isPortOpen = client.isOpen;
    return isPortOpen;
}

// ===========================================
// IPC Handlers
// ===========================================

// Lấy danh sách cổng COM
ipcMain.handle('get-com-ports', async () => {
    try {
        const ports = await SerialPort.SerialPort.list(); // Sử dụng SerialPort.SerialPort.list() cho @serialport/bindings
        return ports.map(port => ({ path: port.path, manufacturer: port.manufacturer }));
    } catch (error) {
        console.error("Error listing COM ports:", error);
        return [];
    }
});

// Kết nối Modbus
ipcMain.handle('connect-modbus', async (event, options) => {
    if (checkPortStatus()) {
        return { success: false, message: 'Đã có kết nối Modbus đang mở. Vui lòng ngắt kết nối trước.' };
    }

    client = new ModbusRTU(); // Tạo một client mới để đảm bảo trạng thái sạch
    client.setID(parseInt(options.slaveId || '1', 10)); // Đặt Slave ID mặc định là 1 nếu không được cung cấp

    try {
        await client.connectRTU(options.comPath, {
            baudRate: parseInt(options.baudRate, 10),
            dataBits: parseInt(options.dataBits, 10),
            parity: options.parity,
            stopBits: parseInt(options.stopBits, 10)
        });
        isPortOpen = true; // Cập nhật trạng thái
        return { success: true, message: `Kết nối Modbus thành công tới ${options.comPath}` };
    } catch (error) {
        isPortOpen = false; // Cập nhật trạng thái nếu có lỗi
        console.error("Modbus connection error:", error);
        // Cố gắng phân biệt lỗi nếu có thể, nhưng chủ yếu vẫn là timeout
        let errorMessage = 'Lỗi kết nối Modbus. Vui lòng kiểm tra lại cấu hình cổng COM và kết nối vật lý.';
        if (error.message.includes('Port is not open')) {
            errorMessage = 'Cổng COM không mở được. Có thể cổng đang bận hoặc không tồn tại.';
        } else if (error.message.includes('Failed to open serial port')) {
            errorMessage = `Không thể mở cổng COM ${options.comPath}. Hãy đảm bảo cổng không bị chương trình khác sử dụng.`;
        } else if (error.message.includes('Timed out')) { // Đây là lỗi phổ biến nhất
            errorMessage = `Thiết bị Modbus không phản hồi. Hãy kiểm tra:
             - Cổng COM: ${options.comPath}
             - Baud Rate: ${options.baudRate}
             - Data Bits: ${options.dataBits}
             - Parity: ${options.parity}
             - Stop Bits: ${options.stopBits}
             - Slave ID: ${options.slaveId} (hoặc 1 nếu không điền)
             - Dây kết nối và nguồn của thiết bị Slave.`;
        }
        return { success: false, message: errorMessage };
    }
});

// Ngắt kết nối Modbus
ipcMain.handle('disconnect-modbus', async () => {
    if (!checkPortStatus()) {
        return { success: false, message: 'Không có kết nối Modbus nào để ngắt.' };
    }
    try {
        await client.close(); // Đảm bảo đóng cổng một cách an toàn
        isPortOpen = false; // Cập nhật trạng thái
        return { success: true, message: 'Đã ngắt kết nối Modbus.' };
    } catch (error) {
        console.error("Modbus disconnection error:", error);
        return { success: false, message: `Lỗi khi ngắt kết nối: ${error.message}` };
    }
});

// Kiểm tra kết nối
ipcMain.handle('test-connection', async (event, { connectionOptions, slaveId }) => {
    // Nếu chưa mở cổng, thì mở tạm để test
    let tempClient = null;
    let tempPortOpened = false;
    let originalSlaveId = client.getID(); // Lưu lại ID gốc

    try {
        if (!checkPortStatus()) { // Nếu cổng chưa mở, tạo client tạm
            tempClient = new ModbusRTU();
            tempClient.setID(parseInt(slaveId, 10)); // Đặt Slave ID để test
            await tempClient.connectRTU(connectionOptions.comPath, {
                baudRate: parseInt(connectionOptions.baudRate, 10),
                dataBits: parseInt(connectionOptions.dataBits, 10),
                parity: connectionOptions.parity,
                stopBits: parseInt(connectionOptions.stopBits, 10)
            });
            tempPortOpened = true;
        } else { // Nếu cổng đã mở, dùng client hiện tại và chỉ thay đổi Slave ID tạm thời
            client.setID(parseInt(slaveId, 10));
            tempClient = client;
        }

        // Thực hiện một lệnh đọc đơn giản để kiểm tra phản hồi
        // Ví dụ: Đọc 1 thanh ghi giữ (holding register) tại địa chỉ 0
        const testAddress = 0;
        await tempClient.readHoldingRegisters(testAddress, 1);
        
        return { success: true, message: 'Kiểm tra kết nối thành công: Thiết bị Modbus phản hồi.' };

    } catch (error) {
        console.error("Test connection error:", error);
        let errorMessage = 'Không thể kiểm tra kết nối. Vui lòng kiểm tra lại cấu hình và thiết bị Modbus.';
        if (error.message.includes('Timed out')) {
            errorMessage = `Kiểm tra kết nối thất bại: Thiết bị Modbus không phản hồi.
            Có thể do:
             - Sai Baud Rate, Data Bits, Parity, Stop Bits.
             - Sai Slave ID: ${slaveId}
             - Lỗi dây kết nối, hoặc thiết bị Slave chưa được cấp nguồn.
             - Địa chỉ thanh ghi ${testAddress} không tồn tại hoặc không thể đọc được.`;
        } else if (error.message.includes('Port is not open') || error.message.includes('Failed to open serial port')) {
            errorMessage = `Không thể mở cổng COM ${connectionOptions.comPath} để kiểm tra. Cổng có thể đang bận hoặc không tồn tại.`;
        }
        return { success: false, message: errorMessage };
    } finally {
        if (tempPortOpened && tempClient) {
            await tempClient.close(); // Đóng cổng tạm thời nếu nó được mở bởi hàm test
        }
        if (tempClient === client) { // Nếu sử dụng client gốc, khôi phục lại Slave ID
            client.setID(originalSlaveId);
        }
    }
});

// --- Hàm dịch mã lỗi Modbus ---
function translateModbusError(error, address) {
    // 1. Lỗi Timeout (phổ biến nhất)
    if (error.message.includes('Timed out')) {
        return `Thiết bị không phản hồi khi truy cập địa chỉ ${address}. Vui lòng kiểm tra lại Slave ID, kết nối vật lý, hoặc thiết bị có thể đang bị treo.`;
    }

    // 2. Lỗi có mã ngoại lệ từ thiết bị
    // Thư viện modbus-serial thường trả về lỗi có dạng 'Modbus exception X: ...'
    if (error.message.includes('Modbus exception')) {
        if (error.message.includes('1')) { // ILLEGAL FUNCTION
            return `Lỗi tại địa chỉ ${address}: Lệnh (function code) không được thiết bị này hỗ trợ.`;
        }
        if (error.message.includes('2')) { // ILLEGAL DATA ADDRESS
            return `Lỗi tại địa chỉ ${address}: Địa chỉ thanh ghi không tồn tại trên thiết bị.`;
        }
        if (error.message.includes('3')) { // ILLEGAL DATA VALUE
            return `Lỗi tại địa chỉ ${address}: Giá trị ghi vào không hợp lệ hoặc nằm ngoài dải cho phép.`;
        }
        if (error.message.includes('4')) { // SLAVE DEVICE FAILURE
            return `Lỗi tại địa chỉ ${address}: Thiết bị Slave báo lỗi nội bộ, không thể xử lý yêu cầu.`;
        }
    }
    
    // 3. Các lỗi khác
    return `Lỗi không xác định khi truy cập địa chỉ ${address}: ${error.message}`;
}

// Đọc thanh ghi
ipcMain.handle('read-register', async (event, { address, count }) => {
    if (!checkPortStatus()) {
        return { success: false, message: 'Không có kết nối Modbus. Vui lòng kết nối trước.' };
    }
    const slaveId = parseInt(document.getElementById('slave-id').value || '1', 10); // Lấy Slave ID từ giao diện
    client.setID(slaveId); // Đảm bảo Slave ID được cập nhật cho mỗi lần đọc/ghi

    try {
        const data = await client.readHoldingRegisters(address, count);
        return { success: true, data: data.data };
    } catch (error) {
        console.error("Modbus read error:", error);
        let errorMessage = `Lỗi khi đọc địa chỉ ${address}: ${error.message}`;
        if (error.message.includes('Timed out')) {
            errorMessage = `Thiết bị Modbus không phản hồi khi đọc địa chỉ ${address}.
            Kiểm tra: Slave ID, kết nối, hoặc địa chỉ này có thể không tồn tại/không đọc được.`;
        }
        return { success: false, message: errorMessage };
    }
});

// Ghi thanh ghi
ipcMain.handle('write-register', async (event, { address, value }) => {
    if (!checkPortStatus()) {
        return { success: false, message: 'Không có kết nối Modbus. Vui lòng kết nối trước.' };
    }
    const slaveId = parseInt(document.getElementById('slave-id').value || '1', 10);
    client.setID(slaveId);

    try {
        await client.writeRegister(address, value);
        return { success: true, message: `Ghi thành công giá trị ${value} vào địa chỉ ${address}.` };
    } catch (error) {
        console.error("Modbus write error:", error);
        let errorMessage = `Lỗi khi ghi vào địa chỉ ${address}: ${error.message}`;
        if (error.message.includes('Timed out')) {
            errorMessage = `Thiết bị Modbus không phản hồi khi ghi vào địa chỉ ${address}.
            Kiểm tra: Slave ID, kết nối, hoặc địa chỉ này có thể chỉ đọc/không ghi được.`;
        }
        return { success: false, message: errorMessage };
    }
});