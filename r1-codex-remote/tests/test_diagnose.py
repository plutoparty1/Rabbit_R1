"""스키마 생성 실패 때도 프로젝트 임시 폴더를 정리하는지 확인합니다."""
from subprocess import CompletedProcess
import unittest
from unittest.mock import patch
from scripts.diagnose import ROOT, diagnose


class DiagnoseTests(unittest.TestCase):
    def test_failed_schema_generation_leaves_no_temporary_directory(self):
        temp = ROOT / '.project_tmp'
        temp.mkdir(exist_ok=True)
        before = set(temp.iterdir())
        with patch('scripts.diagnose.run', return_value={'exitCode': 0, 'output': '[]'}), \
             patch('scripts.diagnose.subprocess.run', return_value=CompletedProcess([], 1, b'', b'')):
            result = diagnose()
        self.assertEqual(result['schemaGenerationExitCode'], 1)
        self.assertFalse(result['sameServerSameThreadProven'])
        self.assertEqual(set(temp.iterdir()), before)


if __name__ == '__main__':
    unittest.main()
