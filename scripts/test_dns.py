from _ssh import connect
import sys

def test_dns():
    client = None
    try:
        client = connect()
        
        # Ejecutar ping printfarm-spoolman dentro del contenedor
        stdin, stdout, stderr = client.exec_command('docker exec printfarm-backend ping -c 2 printfarm-spoolman')
        print("Salida de ping printfarm-spoolman:", stdout.read().decode())
        print("Errores de ping printfarm-spoolman:", stderr.read().decode())
        
        # Ejecutar ping spoolman dentro del contenedor
        stdin, stdout, stderr = client.exec_command('docker exec printfarm-backend ping -c 2 spoolman')
        print("Salida de ping spoolman:", stdout.read().decode())
        print("Errores de ping spoolman:", stderr.read().decode())

    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        if client:
            client.close()

if __name__ == '__main__':
    test_dns()
