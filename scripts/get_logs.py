from _ssh import connect
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

def get_logs():
    client = None
    try:
        client = connect()
        print("Conectado exitosamente. Obteniendo logs...")
        
        # Ejecutar docker logs backend
        stdin, stdout, stderr = client.exec_command('cd printfarm-manager && docker compose logs backend --tail 50')
        
        for line in iter(stdout.readline, ""):
            print(line, end="")
            
        err = stderr.read().decode()
        if err:
            print("Errores:", err, file=sys.stderr)

    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        if client:
            client.close()

if __name__ == '__main__':
    get_logs()
