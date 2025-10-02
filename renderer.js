document.addEventListener('DOMContentLoaded', () => {
    // --- Persistence Keys ---
    const STORAGE_KEYS = {
        // Settings
        BAUD_RATE: 'baudRate',
        DATA_BITS: 'dataBits',
        PARITY: 'parity',
        STOP_BITS: 'stopBits',
        SLAVE_ID: 'slaveId',
        // Read Tab
        READ_FORMAT: 'readFormat',
        READ_START_ADDRESS: 'readStartAddress',
        READ_QUANTITY: 'readQuantity',
        READ_FIELDS: 'readFields', // Stores dynamic addresses/values
        // Write Tab
        WRITE_FORMAT: 'writeFormat',
        WRITE_START_ADDRESS: 'writeStartAddress',
        WRITE_QUANTITY: 'writeQuantity',
        WRITE_FIELDS: 'writeFields' // Stores dynamic addresses/values
    };
    
    // --- Lấy các phần tử DOM ---
    const comPortsSelect = document.getElementById('com-ports');
    const statusDiv = document.getElementById('status');
    const logDiv = document.getElementById('log');

    // Nút điều khiển kết nối
    const btnConnect = document.getElementById('btn-connect');
    const btnDisconnect = document.getElementById('btn-disconnect');
    const btnTestConnection = document.getElementById('btn-test-connection');
    const btnRefreshCom = document.getElementById('btn-refresh-com');

    // Nút thao tác
    const btnRead = document.getElementById('btn-read');
    const btnWrite = document.getElementById('btn-write');

    // Các phần tử cho giao diện động
    const btnConfirmRead = document.getElementById('btn-confirm-read-quantity');
    const btnConfirmWrite = document.getElementById('btn-confirm-write-quantity');
    const readFieldsContainer = document.getElementById('read-fields-container');
    const writeFieldsContainer = document.getElementById('write-fields-container');
    
    const tabs = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    // --- Biến trạng thái cho việc đọc liên tục ---
    let isReading = false;
    let timeoutId = null; 

    // --- Persistence Functions ---
    function saveState() {
        // 1. Save Connection Settings
        localStorage.setItem(STORAGE_KEYS.BAUD_RATE, document.getElementById('baud-rate').value);
        localStorage.setItem(STORAGE_KEYS.DATA_BITS, document.getElementById('data-bits').value);
        localStorage.setItem(STORAGE_KEYS.PARITY, document.getElementById('parity').value);
        localStorage.setItem(STORAGE_KEYS.STOP_BITS, document.getElementById('stop-bits').value);
        localStorage.setItem(STORAGE_KEYS.SLAVE_ID, document.getElementById('slave-id').value);

        // 2. Save Read Settings
        const readFormat = getInputFormat('read');
        localStorage.setItem(STORAGE_KEYS.READ_FORMAT, readFormat);
        localStorage.setItem(STORAGE_KEYS.READ_START_ADDRESS, document.getElementById('read-start-address').value);
        localStorage.setItem(STORAGE_KEYS.READ_QUANTITY, document.getElementById('read-quantity').value);

        // 3. Save Dynamic Read Fields (Addresses and Values)
        const readFields = [];
        const readAddresses = document.querySelectorAll('.dynamic-read-address');
        const readValues = document.querySelectorAll('.dynamic-read-value');
        readAddresses.forEach((addrInput, i) => {
            readFields.push({
                address: addrInput.value,
                value: readValues[i].value 
            });
        });
        if (readFields.length > 0) {
            localStorage.setItem(STORAGE_KEYS.READ_FIELDS, JSON.stringify(readFields));
        } else {
            localStorage.removeItem(STORAGE_KEYS.READ_FIELDS);
        }
        
        // 4. Save Write Settings
        const writeFormat = getInputFormat('write');
        localStorage.setItem(STORAGE_KEYS.WRITE_FORMAT, writeFormat);
        localStorage.setItem(STORAGE_KEYS.WRITE_START_ADDRESS, document.getElementById('write-start-address').value);
        localStorage.setItem(STORAGE_KEYS.WRITE_QUANTITY, document.getElementById('write-quantity').value);

        // 5. Save Dynamic Write Fields (Addresses and Values)
        const writeFields = [];
        const writeAddresses = document.querySelectorAll('.dynamic-write-address');
        const writeValues = document.querySelectorAll('.dynamic-write-value');
        writeAddresses.forEach((addrInput, i) => {
            writeFields.push({
                address: addrInput.value,
                value: writeValues[i].value 
            });
        });
        if (writeFields.length > 0) {
            localStorage.setItem(STORAGE_KEYS.WRITE_FIELDS, JSON.stringify(writeFields));
        } else {
            localStorage.removeItem(STORAGE_KEYS.WRITE_FIELDS);
        }
    }

    // Helper to load simple values and set inputs
    function loadAndSetInput(id, key) {
        const savedValue = localStorage.getItem(key);
        if (savedValue) {
            const element = document.getElementById(id);
            if (element) {
                element.value = savedValue;
            }
        }
    }

    // Function to generate/restore dynamic fields based on saved data
    function loadDynamicFields(tabName) {
        const key = tabName === 'read' ? STORAGE_KEYS.READ_FIELDS : STORAGE_KEYS.WRITE_FIELDS;
        const container = tabName === 'read' ? readFieldsContainer : writeFieldsContainer;
        const quantityId = tabName === 'read' ? 'read-quantity' : 'write-quantity';
        const startAddressId = tabName === 'read' ? 'read-start-address' : 'write-start-address';
        
        const savedFieldsStr = localStorage.getItem(key);
        if (!savedFieldsStr) {
            // Fallback to generating default fields
            tabName === 'read' ? generateReadFields(true) : generateWriteFields(true);
            return;
        }

        try {
            const savedFields = JSON.parse(savedFieldsStr);
            if (!savedFields || savedFields.length === 0) {
                tabName === 'read' ? generateReadFields(true) : generateWriteFields(true);
                return;
            }

            // Restore quantity and address inputs based on the first saved field
            const savedQuantity = savedFields.length;
            const savedStartAddress = savedFields[0].address;
            
            // Chỉ khôi phục giá trị nếu hợp lệ với giới hạn
            if (savedQuantity >= 1 && savedQuantity <= (tabName === 'read' ? 20 : 50)) {
                 document.getElementById(quantityId).value = savedQuantity;
            }

            document.getElementById(startAddressId).value = savedStartAddress;

            container.innerHTML = '';
            
            savedFields.forEach((field, i) => {
                const addressInput = document.createElement('input');
                addressInput.type = 'text';
                addressInput.placeholder = `Địa chỉ #${i + 1}`;
                addressInput.className = `dynamic-${tabName}-address`;
                addressInput.value = field.address; 
                
                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.placeholder = `Giá trị${tabName === 'write' ? ' (Dec)' : ''} #${i + 1}`;
                valueInput.className = `dynamic-${tabName}-value`;
                valueInput.value = field.value; 
                
                if (tabName === 'read') {
                    valueInput.disabled = true;
                    valueInput.classList.add('dynamic-read-value'); // Đảm bảo lớp cho CSS làm nổi bật
                } else {
                    valueInput.classList.add('dynamic-write-value');
                }
                
                container.appendChild(addressInput);
                container.appendChild(valueInput);
            });

            // Không cần log khi khôi phục, chỉ cần log khi tạo mới (generateReadFields/generateWriteFields)

        } catch (e) {
            console.error(`Error loading ${tabName} fields:`, e);
            // Fallback
            tabName === 'read' ? generateReadFields(true) : generateWriteFields(true); 
        }
    }


    function loadState() {
        // 1. Load Connection Settings
        loadAndSetInput('baud-rate', STORAGE_KEYS.BAUD_RATE);
        loadAndSetInput('data-bits', STORAGE_KEYS.DATA_BITS);
        loadAndSetInput('parity', STORAGE_KEYS.PARITY);
        loadAndSetInput('stop-bits', STORAGE_KEYS.STOP_BITS);
        loadAndSetInput('slave-id', STORAGE_KEYS.SLAVE_ID);

        // 2. Load Read/Write Settings (excluding dynamic inputs)
        loadAndSetInput('read-start-address', STORAGE_KEYS.READ_START_ADDRESS);
        loadAndSetInput('read-quantity', STORAGE_KEYS.READ_QUANTITY);
        loadAndSetInput('write-start-address', STORAGE_KEYS.WRITE_START_ADDRESS);
        loadAndSetInput('write-quantity', STORAGE_KEYS.WRITE_QUANTITY);
        
        // Restore radio button state
        const savedReadFormat = localStorage.getItem(STORAGE_KEYS.READ_FORMAT);
        if (savedReadFormat) {
            const radio = document.querySelector(`input[name="read-format"][value="${savedReadFormat}"]`);
            if (radio) radio.checked = true;
        }
        
        const savedWriteFormat = localStorage.getItem(STORAGE_KEYS.WRITE_FORMAT);
        if (savedWriteFormat) {
            const radio = document.querySelector(`input[name="write-format"][value="${savedWriteFormat}"]`);
            if (radio) radio.checked = true;
        }
        
        // 3. Restore Dynamic Fields. 
        loadDynamicFields('read');
        loadDynamicFields('write');
    }
    
    // --- Các hàm hỗ trợ ---
    function log(message, type = 'info') {
        const p = document.createElement('p');
        const timestamp = new Date().toLocaleTimeString();
        p.textContent = `[${timestamp}] ${message}`;
        if (type === 'error') p.style.color = '#ff4d4d';
        if (type === 'success') p.style.color = '#73e68c';
        logDiv.appendChild(p);
        logDiv.scrollTop = logDiv.scrollHeight;
    }
    
    function updateConnectionStatus(isConnected, message) {
        statusDiv.textContent = message;
        btnConnect.disabled = isConnected;
        btnTestConnection.disabled = !isConnected; 
        btnDisconnect.disabled = !isConnected;
        btnRead.disabled = !isConnected;
        btnWrite.disabled = !isConnected;
        if (isConnected) {
            statusDiv.className = 'status-connected';
        } else {
            statusDiv.className = 'status-disconnected';
            if (isReading) {
                stopContinuousRead();
            }
        }
    }

    function getInputFormat(tabName) {
        const radio = document.querySelector(`input[name="${tabName}-format"]:checked`);
        return radio ? radio.value : 'dec';
    }

    function parseInput(value, format) {
        if (format === 'hex') return parseInt(value, 16);
        return parseInt(value, 10);
    }
    
    // --- Logic cho Giao diện Động ---
    // Thêm tham số isRestoring để kiểm soát việc lưu và log khi khôi phục trạng thái
    function generateReadFields(isRestoring = false) {
        if (isReading) {
            stopContinuousRead();
        }
        const quantity = parseInt(document.getElementById('read-quantity').value, 10);
        const startAddressStr = document.getElementById('read-start-address').value; 
        const format = getInputFormat('read'); 
        const startAddress = parseInput(startAddressStr, format); 

        readFieldsContainer.innerHTML = '';
        
        if (isNaN(quantity) || quantity < 1 || quantity > 20) {
            if (!isRestoring) log('Số lượng thanh ghi không hợp lệ. Vui lòng nhập một số từ 1 đến 20.', 'error');
            return;
        }
        if (isNaN(startAddress)) {
             if (!isRestoring) log('Địa chỉ bắt đầu không hợp lệ.', 'error');
             return;
        }
        
        for (let i = 0; i < quantity; i++) {
            const currentAddress = startAddress + i; 
            const currentAddressStr = format === 'hex' ? currentAddress.toString(16).toUpperCase() : currentAddress.toString(10); 

            const addressInput = document.createElement('input');
            addressInput.type = 'text';
            addressInput.placeholder = `Địa chỉ #${i + 1}`;
            addressInput.className = 'dynamic-read-address';
            addressInput.value = currentAddressStr; 
            
            const valueDisplay = document.createElement('input');
            valueDisplay.type = 'text';
            valueDisplay.placeholder = `Giá trị`;
            valueDisplay.className = 'dynamic-read-value';
            valueDisplay.disabled = true;
            
            readFieldsContainer.appendChild(addressInput);
            readFieldsContainer.appendChild(valueDisplay);
        }
        if (!isRestoring) {
            log(`Đã tạo ${quantity} cặp ô để đọc địa chỉ, bắt đầu từ ${startAddressStr} (${format.toUpperCase()}).`);
            saveState(); // Lưu trạng thái sau khi tạo mới
        }
    }

    // Thêm tham số isRestoring để kiểm soát việc lưu và log khi khôi phục trạng thái
    function generateWriteFields(isRestoring = false) {
        const quantity = parseInt(document.getElementById('write-quantity').value, 10);
        const startAddressStr = document.getElementById('write-start-address').value; 
        const format = getInputFormat('write'); 
        const startAddress = parseInput(startAddressStr, format); 

        writeFieldsContainer.innerHTML = '';

        if (isNaN(quantity) || quantity < 1 || quantity > 20) {
            if (!isRestoring) log('Số lượng thanh ghi không hợp lệ. Vui lòng nhập một số từ 1 đến 20.', 'error');
            return;
        }
        if (isNaN(startAddress)) {
             if (!isRestoring) log('Địa chỉ bắt đầu không hợp lệ.', 'error');
             return;
        }
        
        for (let i = 0; i < quantity; i++) {
            const currentAddress = startAddress + i; 
            const currentAddressStr = format === 'hex' ? currentAddress.toString(16).toUpperCase() : currentAddress.toString(10); 

            const addressInput = document.createElement('input');
            addressInput.type = 'text';
            addressInput.placeholder = `Địa chỉ #${i + 1}`;
            addressInput.className = 'dynamic-write-address';
            addressInput.value = currentAddressStr; 
            
            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.placeholder = `Giá trị (Dec) #${i + 1}`;
            valueInput.className = 'dynamic-write-value';
            
            writeFieldsContainer.appendChild(addressInput);
            writeFieldsContainer.appendChild(valueInput);
        }
        if (!isRestoring) {
             log(`Đã tạo ${quantity} cặp ô để ghi địa chỉ/giá trị, bắt đầu từ ${startAddressStr} (${format.toUpperCase()}).`);
             saveState(); // Lưu trạng thái sau khi tạo mới
        }
    }

    // Vòng lặp đọc chính (Logic Polling giữ nguyên)
    async function readLoop() {
        if (!isReading) return;

        const format = getInputFormat('read');
        const addressInputs = document.querySelectorAll('.dynamic-read-address');
        const valueDisplays = document.querySelectorAll('.dynamic-read-value');
        const slaveId = document.getElementById('slave-id').value; 
        const delayBetweenReads = 10; 
        
        for (let i = 0; i < addressInputs.length; i++) {
            if (!isReading) return;
            
            const addressStr = addressInputs[i].value;
            if (!addressStr.trim()) {
                valueDisplays[i].value = "";
                continue;
            }

            const address = parseInput(addressStr, format);
            if (isNaN(address)) {
                valueDisplays[i].value = "Lỗi địa chỉ";
                continue;
            }

            try {
                const result = await window.api.readRegister({ address, count: 1, slaveId });
                
                if (result.success) {
                    valueDisplays[i].value = result.data && result.data.length > 0 ? result.data[0].toString(10) : "N/A";
                    saveState(); // Lưu giá trị mới nhất sau khi đọc thành công
                } else {
                    valueDisplays[i].value = "Lỗi";
                    log(`Lỗi đọc địa chỉ ${address} (${format.toUpperCase()}): ${result.message}`, 'error');
                }
            } catch (error) {
                log(`Lỗi nghiêm trọng khi đọc: ${error.message}`, 'error');
                stopContinuousRead();
                return;
            }

            await new Promise(resolve => setTimeout(resolve, delayBetweenReads));
        }
        
        const delayBetweenCycles = 20;
        timeoutId = setTimeout(readLoop, delayBetweenCycles);
    }

    function startContinuousRead() {
        isReading = true;
        btnRead.textContent = 'Huỷ Đọc';
        btnRead.classList.add('reading');
        log('Bắt đầu đọc real-time...');
        readLoop();
    }

    function stopContinuousRead() {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = null;
        isReading = false;
        btnRead.textContent = 'Thực hiện Đọc';
        btnRead.classList.remove('reading');
        log('Đã dừng đọc.');
    }
    
    // --- Khởi tạo và Sự kiện ---
    async function loadComPorts() {
        log('Đang tìm kiếm cổng COM...');
        const ports = await window.api.getComPorts();
        comPortsSelect.innerHTML = '';
        if (ports.length === 0) {
            log('Không tìm thấy cổng COM nào.', 'error');
        } else {
            ports.forEach(port => {
                const option = document.createElement('option');
                option.value = port.path;
                option.textContent = port.path;
                comPortsSelect.appendChild(option);
            });
            log(`Đã tìm thấy ${ports.length} cổng COM.`);
        }
        // Khôi phục cổng COM đã chọn (nếu có) sau khi tải danh sách
        const savedComPath = localStorage.getItem('comPath');
        if (savedComPath && document.querySelector(`option[value="${savedComPath}"]`)) {
            comPortsSelect.value = savedComPath;
        }
        comPortsSelect.addEventListener('change', (e) => localStorage.setItem('comPath', e.target.value));
    }
    
    // ----------------------------------------------------
    // *** KHÔI PHỤC TRẠNG THÁI NGAY KHI TẢI TRANG ***
    loadState(); 
    // ----------------------------------------------------
    
    // Khởi tạo cổng COM (Phải chạy sau loadState để đảm bảo giá trị input được load)
    loadComPorts(); 

    // Gắn Event Listeners để LƯU TRẠNG THÁI NGAY LẬP TỨC khi có thay đổi
    // Connection Settings listeners
    document.getElementById('baud-rate').addEventListener('change', saveState);
    document.getElementById('data-bits').addEventListener('change', saveState);
    document.getElementById('parity').addEventListener('change', saveState);
    document.getElementById('stop-bits').addEventListener('change', saveState);
    document.getElementById('slave-id').addEventListener('input', saveState);
    
    // Read Settings listeners
    document.getElementById('read-start-address').addEventListener('input', saveState);
    document.getElementById('read-quantity').addEventListener('input', saveState);
    document.querySelectorAll('input[name="read-format"]').forEach(radio => {
        radio.addEventListener('change', saveState);
    });
    
    // Write Settings listeners
    document.getElementById('write-start-address').addEventListener('input', saveState);
    document.getElementById('write-quantity').addEventListener('input', saveState);
    document.querySelectorAll('input[name="write-format"]').forEach(radio => {
        radio.addEventListener('change', saveState);
    });
    
    // Dynamic field changes (manual typing of addresses/values)
    readFieldsContainer.addEventListener('input', saveState);
    writeFieldsContainer.addEventListener('input', saveState);
    
    // Button listeners
    btnRefreshCom.addEventListener('click', loadComPorts);
    
    btnConfirmRead.addEventListener('click', () => {
        generateReadFields(); // Tự gọi saveState bên trong nếu không phải restoring
    });
    btnConfirmWrite.addEventListener('click', () => {
        generateWriteFields(); // Tự gọi saveState bên trong nếu không phải restoring
    });

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(item => item.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            tabContents.forEach(content => content.classList.remove('active'));
            target.classList.add('active');
        });
    });

    // SỬA LẠI: Chỉ kết nối COM. Nút Test Connection sẽ kiểm tra Slave ID.
    btnConnect.addEventListener('click', async () => {
        const options = {
            comPath: comPortsSelect.value,
            baudRate: document.getElementById('baud-rate').value,
            parity: document.getElementById('parity').value,
            dataBits: document.getElementById('data-bits').value,
            stopBits: document.getElementById('stop-bits').value
        };
        if (!options.comPath) {
            log('Vui lòng chọn một cổng COM.', 'error'); return;
        }
        log(`Đang kết nối cổng COM: ${options.comPath}...`);
        const result = await window.api.connectModbus(options);
        
        if (result.success) {
            updateConnectionStatus(true, `ĐÃ KẾT NỐI: ${options.comPath}`);
            log(result.message, 'success');
        } else {
            updateConnectionStatus(false, 'NGẮT KẾT NỐI');
            log(result.message, 'error');
        }
    });

    btnDisconnect.addEventListener('click', async () => {
        log('Đang ngắt kết nối...');
        if (isReading) {
            stopContinuousRead();
        }
        const result = await window.api.disconnectModbus();
        updateConnectionStatus(false, 'NGẮT KẾT NỐI');
        log(result.message, result.success ? 'info' : 'error');
    });

    // SỬA LẠI: Thực hiện kiểm tra kết nối Slave ID sau khi cổng COM đã mở
    btnTestConnection.addEventListener('click', async () => {
        const connectionOptions = { comPath: comPortsSelect.value, baudRate: document.getElementById('baud-rate').value, parity: document.getElementById('parity').value, dataBits: document.getElementById('data-bits').value, stopBits: document.getElementById('stop-bits').value };
        const slaveId = document.getElementById('slave-id').value;
        
        // Kiểm tra xem cổng COM đã được chọn chưa (trước khi gọi API)
        if (!connectionOptions.comPath) { 
            log('Lỗi: Vui lòng chọn một cổng COM.', 'error'); 
            return; 
        }

        log(`Đang kiểm tra kết nối với Slave ID: ${slaveId}...`);
        
        // Gọi API testConnection, API này sẽ kiểm tra isPortOpen trước khi gửi lệnh
        const result = await window.api.testConnection({ connectionOptions, slaveId });
        
        if (result.success) { 
            log(result.message, 'success'); 
        } else { 
            log(result.message, 'error'); 
        }
    });

    // --- Sự kiện ĐỌC ---
    btnRead.addEventListener('click', () => {
        if (isReading) {
            stopContinuousRead();
        } else {
            startContinuousRead();
        }
    });
    
    // --- Sự kiện GHI (Logic này đã là tuần tự và được giữ nguyên) ---
    btnWrite.addEventListener('click', async () => {
        if (isReading) {
            log('Vui lòng dừng đọc trước khi thực hiện ghi.', 'error');
            return;
        }

        const format = getInputFormat('write');
        const addressInputs = document.querySelectorAll('.dynamic-write-address');
        const valueInputs = document.querySelectorAll('.dynamic-write-value');

        const slaveId = document.getElementById('slave-id').value;

        log(`Bắt đầu ghi vào ${addressInputs.length} địa chỉ...`);

        // Vòng lặp for với 'await' đảm bảo lệnh ghi tuần tự
        for (let i = 0; i < addressInputs.length; i++) {
            const addressStr = addressInputs[i].value;
            const valueStr = valueInputs[i].value;

            if (!addressStr.trim() && !valueStr.trim()) continue;

            const address = parseInput(addressStr, format);
            const value = parseInt(valueStr, 10);

            if (isNaN(address) || isNaN(value)) {
                log(`Lỗi: Dữ liệu không hợp lệ ở cặp #${i + 1} (Địa chỉ: "${addressStr}", Giá trị: "${valueStr}"). Bỏ qua.`, 'error');
                continue;
            }

            log(`--> Đang ghi: Địa chỉ ${address} (Dec), Giá trị ${value} (Dec)`);
            
            const result = await window.api.writeRegister({ address, value, slaveId });

            if (result.success) {
                log(`<-- ${result.message}`, 'success');
            } else {
                log(`<-- Lỗi khi ghi vào địa chỉ ${address}: ${result.message}`, 'error');
            }
            
            // LƯU TRẠNG THÁI SAU KHI GHI XONG
            saveState(); 
            // THÊM ĐỘ TRỄ NHỎ GIỮA CÁC LỆNH GHI (Tương tự như khi đọc)
            await new Promise(resolve => setTimeout(resolve, 10)); 
        }
        log('Hoàn tất quá trình ghi.');
    });
});